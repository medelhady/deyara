import { NextResponse } from "next/server";
import { createUploadSlot, verifyStoredVideo } from "@/lib/whatsapp/media";
import { mediaKindFor, mediaKindLabels, mediaSizeLimits } from "@/lib/media-kinds";

export const dynamic = "force-dynamic";

/**
 * The two halves of attaching a file to a campaign.
 *
 * The file itself never passes through this app: a serverless request body is capped well below the
 * 16MB WhatsApp carries, so the browser is handed a signed slot and uploads straight to storage.
 * Then it comes back here to be checked, because a file Meta accepts and silently refuses to deliver
 * would leave every marketer answered with nothing while the dashboard called it sent.
 *
 * Videos are inspected byte by byte -- H.265 is the failure that costs a whole campaign. The other
 * kinds are checked for size and type only: a picture or a voice note WhatsApp cannot take is
 * refused at the send with a reason, and there is nothing inside them worth reading first.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    step?: string;
    contentType?: string;
    size?: number;
    path?: string;
    name?: string;
    kind?: string;
  };

  if (body.step === "verify") {
    const path = String(body.path ?? "").trim();

    if (!path) {
      return NextResponse.json({ error: "لم يُرفع أي ملف." }, { status: 400 });
    }

    // Only a video has bytes worth reading before it is sent.
    if (body.kind && body.kind !== "video") {
      return NextResponse.json({ ok: true, path });
    }

    const result = await verifyStoredVideo(path);

    if (!result.ok) {
      // The file itself is the problem, and there is one way out that needs no software and no
      // computer -- so it travels with the error rather than waiting to be asked for.
      return NextResponse.json({ error: result.error, hint: true }, { status: 400 });
    }

    return NextResponse.json({ ok: true, path });
  }

  const size = Number(body.size ?? 0);
  const name = String(body.name ?? "");
  const declared = String(body.contentType ?? "");
  const kind = mediaKindFor(declared, name);

  /**
   * What the file is, when the browser will not say.
   *
   * A file picked on Windows, or a voice note recorded on a phone, can arrive with an empty type or
   * as application/octet-stream. The extension decides then, and anything still unrecognised is
   * sent as a document -- the kind WhatsApp accepts without asking what is inside it.
   */
  const contentType = declared.includes("/") ? declared : kind === "audio" ? "audio/mpeg" : "application/octet-stream";

  // Refused before the upload rather than after it: the admin is on a phone connection, and finding
  // out at the end of a 40MB upload is finding out too late. The number is said out loud, because
  // "too big" without it leaves them guessing how much to cut.
  if (size > mediaSizeLimits[kind]) {
    const megabytes = Math.round((size / (1024 * 1024)) * 10) / 10;
    const limit = Math.round(mediaSizeLimits[kind] / (1024 * 1024));

    return NextResponse.json(
      {
        error: `${mediaKindLabels[kind].label} بحجم ${megabytes} ميجابايت، والحد ${limit} — واتساب لا يقبل أكبر من ذلك.`,
        hint: kind === "video"
      },
      { status: 400 }
    );
  }

  const slot = await createUploadSlot(contentType, "campaigns", name);

  if (slot.error || !slot.url) {
    return NextResponse.json({ error: slot.error ?? "تعذر تجهيز الرفع." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, url: slot.url, path: slot.path, kind });
}
