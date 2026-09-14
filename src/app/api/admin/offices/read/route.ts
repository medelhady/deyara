import { NextResponse } from "next/server";
import { readOfficeScreenshot } from "@/lib/offices";
import { createUploadSlot, readStoredFile } from "@/lib/whatsapp/media";

export const dynamic = "force-dynamic";
// Reading a screenshot is a round trip to OpenAI with an image attached.
export const maxDuration = 60;

/**
 * Turns one screenshot into a draft row, in two steps.
 *
 * The picture is uploaded straight to storage from the browser -- a serverless request body is
 * capped well below what a phone screenshot can weigh -- and then read here, where the key lives.
 *
 * Nothing is saved: the reading comes back for correction first, because a digit misread in a phone
 * number is a row that looks right and reaches nobody.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { step?: string; contentType?: string; name?: string; path?: string };

  if (body.step === "read") {
    const path = String(body.path ?? "").trim();

    if (!path) {
      return NextResponse.json({ error: "لم تُرفع أي صورة." }, { status: 400 });
    }

    const file = await readStoredFile(path);

    if (!file.found) {
      return NextResponse.json({ error: file.error }, { status: 400 });
    }

    const reading = await readOfficeScreenshot(`data:${file.contentType};base64,${file.base64}`);

    if (!reading.ok) {
      return NextResponse.json({ error: reading.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, draft: reading.draft, path });
  }

  const name = String(body.name ?? "").toLowerCase();
  const declared = String(body.contentType ?? "");
  // A screenshot from a phone can arrive with no type at all; the extension is the next best
  // evidence, and the file is read back before anything is done with it either way.
  const byExtension = name.endsWith(".png")
    ? "image/png"
    : name.endsWith(".webp")
      ? "image/webp"
      : name.endsWith(".jpg") || name.endsWith(".jpeg")
        ? "image/jpeg"
        : "";
  const contentType = declared.startsWith("image/") ? declared : byExtension;

  if (!contentType) {
    return NextResponse.json({ error: "اختر صورة (PNG أو JPG)." }, { status: 400 });
  }

  const slot = await createUploadSlot(contentType, "offices");

  if (slot.error || !slot.url) {
    return NextResponse.json({ error: slot.error ?? "تعذر تجهيز الرفع." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, url: slot.url, path: slot.path });
}
