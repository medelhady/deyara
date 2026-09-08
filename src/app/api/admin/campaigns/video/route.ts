import { NextResponse } from "next/server";
import { createUploadSlot, verifyStoredVideo } from "@/lib/whatsapp/media";
import { maxVideoBytes } from "@/lib/video-health";

export const dynamic = "force-dynamic";

/**
 * The two halves of uploading a campaign video.
 *
 * The file itself never passes through this app: a serverless request body is capped well below the
 * 16MB WhatsApp carries, so the browser is handed a signed slot and uploads straight to storage.
 * Then it comes back here to be read and checked, because a video Meta accepts and silently refuses
 * to deliver would leave every marketer answered with nothing while the dashboard called it sent.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    step?: string;
    contentType?: string;
    size?: number;
    path?: string;
    name?: string;
  };

  if (body.step === "verify") {
    const path = String(body.path ?? "").trim();

    if (!path) {
      return NextResponse.json({ error: "لم يُرفع أي ملف." }, { status: 400 });
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
  const name = String(body.name ?? "").toLowerCase();

  /**
   * What the file is, when the browser will not say.
   *
   * A file picked on Windows or from a phone can arrive with an empty type, or as
   * application/octet-stream, and refusing those means telling someone their video is not a video.
   * The extension is the next best evidence, and the bytes themselves are inspected after the upload
   * regardless -- nothing is trusted here that is not checked there.
   */
  const declared = String(body.contentType ?? "");
  const byExtension = name.endsWith(".mp4")
    ? "video/mp4"
    : name.endsWith(".mov")
      ? "video/quicktime"
      : name.endsWith(".3gp")
        ? "video/3gpp"
        : "";
  const contentType = declared.startsWith("video/") ? declared : byExtension;

  if (!contentType) {
    return NextResponse.json(
      { error: "اختر ملف فيديو (MP4 أو MOV)." },
      { status: 400 }
    );
  }

  // Refused before the upload rather than after it: the admin is on a phone connection, and finding
  // out at the end of a 40MB upload is finding out too late. The number is said out loud, because
  // "too big" without it leaves them guessing how much to cut.
  if (size > maxVideoBytes) {
    const megabytes = Math.round((size / (1024 * 1024)) * 10) / 10;

    return NextResponse.json(
      {
        error: `الفيديو ${megabytes} ميجابايت، والحد 16 — واتساب لا يقبل أكبر من ذلك.`,
        hint: true
      },
      { status: 400 }
    );
  }

  const slot = await createUploadSlot(contentType);

  if (slot.error || !slot.url) {
    return NextResponse.json({ error: slot.error ?? "تعذر تجهيز الرفع." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, url: slot.url, path: slot.path });
}
