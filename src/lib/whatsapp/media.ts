import { getServiceSupabase } from "@/lib/supabase/server";
import { inspectMp4 } from "@/lib/mp4-inspect";
import { maxVideoBytes } from "@/lib/video-health";

export const propertyMediaBucket = "property-media";

// WhatsApp media links are not public: Meta's expire within minutes and need a bearer token, so a
// link stored as-is is unusable by the time an admin opens it.
async function downloadWhatsAppMedia(url: string) {
  const headers: Record<string, string> = {};

  if (url.includes("lookaside") || url.includes("facebook") || url.includes("fbcdn")) {
    const token = process.env.META_WHATSAPP_TOKEN;

    if (!token) {
      return null;
    }

    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    console.error("Failed to download WhatsApp media", response.status, await response.text());
    return null;
  }

  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? undefined
  };
}

function extensionFor(contentType: string) {
  if (contentType.includes("quicktime")) return "mov";
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  return "bin";
}

/**
 * Copies a WhatsApp media file into the private property-media bucket.
 * Returns the storage path, or null so callers can fall back to the original link.
 */
export async function storePropertyMedia(url: string, contentType: string, ownerPhone: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return null;
  }

  const downloaded = await downloadWhatsAppMedia(url);

  if (!downloaded) {
    return null;
  }

  const resolvedType = downloaded.contentType ?? contentType;
  const path = `${ownerPhone.replace(/\D/g, "")}/${Date.now()}.${extensionFor(resolvedType)}`;

  const { error } = await supabase.storage.from(propertyMediaBucket).upload(path, downloaded.body, {
    contentType: resolvedType,
    upsert: false
  });

  if (error) {
    console.error("Failed to upload property media", error);
    return null;
  }

  return path;
}

/**
 * Copies a listing video into storage, refusing one WhatsApp will not relay.
 *
 * WhatsApp transcodes a video sent as a video, but not one sent as a file, so an editor export in
 * H.265 arrives intact -- and Meta then takes the upload, accepts the send and silently declines to
 * deliver it. Caught here it costs the owner one message; caught later it costs the listing, because
 * nothing downstream can tell the difference between that and a video that arrived.
 */
export async function storePropertyVideo(url: string, contentType: string, ownerPhone: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { path: null, error: null };
  }

  const downloaded = await downloadWhatsAppMedia(url);

  if (!downloaded) {
    return { path: null, error: "تعذّر حفظ الفيديو. أعد إرساله من فضلك." };
  }

  const report = inspectMp4(downloaded.body);

  if (report.problems.length > 0) {
    return { path: null, error: report.problems.join(" ") };
  }

  const resolvedType = downloaded.contentType ?? contentType;
  const path = `${ownerPhone.replace(/\D/g, "")}/${Date.now()}.${extensionFor(resolvedType)}`;

  const { error } = await supabase.storage.from(propertyMediaBucket).upload(path, downloaded.body, {
    contentType: resolvedType,
    upsert: false
  });

  if (error) {
    console.error("Failed to upload property media", error);
    return { path: null, error: "تعذّر حفظ الفيديو. أعد إرساله من فضلك." };
  }

  return { path, error: null };
}

/** Signed links for a private bucket. Anything already stored as a full URL is passed through. */
export async function signPropertyMedia(storageUrl: string, expiresInSeconds = 60 * 60) {
  if (/^https?:\/\//i.test(storageUrl)) {
    return storageUrl;
  }

  const supabase = getServiceSupabase();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from(propertyMediaBucket)
    .createSignedUrl(storageUrl, expiresInSeconds);

  if (error) {
    console.error("Failed to sign property media", error);
    return null;
  }

  return data?.signedUrl ?? null;
}

/**
 * Removes one file from the bucket.
 *
 * For the walkthrough video, which no row ever points at: an orphaned object cannot be found again
 * to clean up later, so it is deleted at the moment its owner is still known.
 */
export async function deletePropertyMedia(storageUrl: string) {
  const supabase = getServiceSupabase();

  if (!supabase || /^https?:\/\//i.test(storageUrl)) {
    return;
  }

  const { error } = await supabase.storage.from(propertyMediaBucket).remove([storageUrl]);

  if (error) {
    console.error("Failed to remove property media", error);
  }
}

/**
 * A place in the bucket for a file the dashboard uploads, and permission to put it there.
 *
 * The browser uploads straight to storage rather than through this app: a serverless request body is
 * capped well below the 16MB WhatsApp allows, so a video sent through the app would be refused at a
 * size WhatsApp would have carried.
 */
export async function createUploadSlot(contentType: string, folder = "campaigns") {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { error: "قاعدة البيانات غير مربوطة." as const, path: null, url: null };
  }

  const path = `${folder}/${Date.now()}.${extensionFor(contentType)}`;
  const { data, error } = await supabase.storage.from(propertyMediaBucket).createSignedUploadUrl(path);

  if (error || !data) {
    console.error("Failed to create an upload slot", error);

    return { error: "تعذر تجهيز الرفع. حاول مرة أخرى." as const, path: null, url: null };
  }

  return { error: null, path, url: data.signedUrl };
}

/**
 * Reads an uploaded video back and refuses one WhatsApp will not relay.
 *
 * The same trap as a listing video, and worse here: an editor export in H.265 is accepted by Meta,
 * acknowledged with an id, and silently never delivered -- so a campaign would answer every marketer
 * with nothing at all, and the dashboard would show it as sent. Checked once at upload, where the
 * admin can still fix it, and the bad file is removed rather than left in the bucket.
 */
export async function verifyStoredVideo(path: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { ok: false as const, error: "قاعدة البيانات غير مربوطة." };
  }

  const { data, error } = await supabase.storage.from(propertyMediaBucket).download(path);

  if (error || !data) {
    return { ok: false as const, error: "تعذر قراءة الفيديو بعد الرفع." };
  }

  const bytes = Buffer.from(await data.arrayBuffer());
  const problems: string[] = [];

  if (bytes.length > maxVideoBytes) {
    problems.push(`الفيديو أكبر من 16 ميجابايت، وواتساب لا يقبل أكبر من ذلك.`);
  }

  problems.push(...inspectMp4(bytes).problems);

  if (problems.length > 0) {
    await deletePropertyMedia(path);

    return { ok: false as const, error: problems.join(" ") };
  }

  return { ok: true as const, error: null };
}
