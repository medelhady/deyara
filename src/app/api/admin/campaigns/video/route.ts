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
  const body = (await request.json()) as { step?: string; contentType?: string; size?: number; path?: string };

  if (body.step === "verify") {
    const path = String(body.path ?? "").trim();

    if (!path) {
      return NextResponse.json({ error: "لم يُرفع أي ملف." }, { status: 400 });
    }

    const result = await verifyStoredVideo(path);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, path });
  }

  const contentType = String(body.contentType ?? "");
  const size = Number(body.size ?? 0);

  if (!contentType.startsWith("video/")) {
    return NextResponse.json({ error: "اختر ملف فيديو." }, { status: 400 });
  }

  // Refused before the upload rather than after it: the admin is on a phone connection, and finding
  // out at the end of a 40MB upload is finding out too late.
  if (size > maxVideoBytes) {
    return NextResponse.json(
      { error: "الفيديو أكبر من 16 ميجابايت، وواتساب لا يقبل أكبر من ذلك. اضغطه ثم أعد المحاولة." },
      { status: 400 }
    );
  }

  const slot = await createUploadSlot(contentType);

  if (slot.error || !slot.url) {
    return NextResponse.json({ error: slot.error ?? "تعذر تجهيز الرفع." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, url: slot.url, path: slot.path });
}
