import { getServiceSupabase } from "@/lib/supabase/server";

export const propertyMediaBucket = "property-media";

// WhatsApp media links are not public. Meta's expire within minutes and need a bearer token, and
// Twilio's need basic auth, so a link stored as-is is unusable by the time an admin opens it.
async function downloadWhatsAppMedia(url: string) {
  const headers: Record<string, string> = {};

  if (url.includes("lookaside") || url.includes("facebook") || url.includes("fbcdn")) {
    const token = process.env.META_WHATSAPP_TOKEN;

    if (!token) {
      return null;
    }

    headers.Authorization = `Bearer ${token}`;
  } else if (url.includes("twilio.com")) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      return null;
    }

    headers.Authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
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
