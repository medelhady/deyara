import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { signPropertyMedia } from "@/lib/whatsapp/media";
import { checkVideoUrl } from "@/lib/video-health";
import { inspectMp4 } from "@/lib/mp4-inspect";
import { metaWhatsAppProvider, uploadMetaVideo } from "@/lib/whatsapp/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Step = { name: string; ok: boolean; detail: string };

/**
 * Sends one listing's video to the admin's own number and reports every step.
 *
 * Built because the failure it diagnoses leaves no trace anywhere else: Meta answers a link-based
 * send before fetching the link, so a video that never arrives and a video that sends perfectly look
 * identical from the server. This runs the real file through the real call and hands back what Meta
 * actually said, rather than what we assumed it would say.
 */
export async function POST(request: Request) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "قاعدة البيانات غير مربوطة." }, { status: 400 });
  }

  const body = (await request.json()) as { propertyId?: string };
  const propertyId = String(body.propertyId ?? "");

  if (!propertyId) {
    return NextResponse.json({ error: "لم تحدد إعلانًا." }, { status: 400 });
  }

  const steps: Step[] = [];
  const { adminNotifyNumbers } = await getSettings();
  const target = adminNotifyNumbers.split(",").map((number) => number.trim()).filter(Boolean)[0];

  if (!target) {
    return NextResponse.json({ error: "لا يوجد رقم إدارة في الإعدادات لإرسال الاختبار إليه." }, { status: 400 });
  }

  const { data: media } = await supabase
    .from("property_media")
    .select("storage_url,content_type")
    .eq("property_id", propertyId)
    .eq("type", "video")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const stored = (media?.storage_url as string | undefined) ?? "";

  steps.push({
    name: "المحفوظ في قاعدة البيانات",
    ok: Boolean(stored),
    detail: stored ? stored : "لا يوجد صف فيديو لهذا الإعلان."
  });

  if (!stored) {
    return NextResponse.json({ ok: false, target, steps });
  }

  // A stored value that is already a URL means the copy into storage failed and the expiring
  // WhatsApp link was kept instead -- the original cause, and it is worth naming on sight.
  const looksLikeUrl = /^https?:\/\//i.test(stored);

  steps.push({
    name: "شكل القيمة",
    ok: !looksLikeUrl,
    detail: looksLikeUrl
      ? "رابط كامل لا مسار تخزين — أي أن نسخ الفيديو فشل وقت النشر، والرابط منتهي غالبًا."
      : "مسار تخزين سليم."
  });

  const signed = await signPropertyMedia(stored);

  steps.push({
    name: "توقيع الرابط",
    ok: Boolean(signed),
    detail: signed ? `${signed.slice(0, 90)}...` : "تعذّر التوقيع — الملف غالبًا غير موجود في التخزين."
  });

  if (!signed) {
    return NextResponse.json({ ok: false, target, steps });
  }

  const health = await checkVideoUrl(signed);

  steps.push({
    name: "فحص الرابط",
    ok: health.ok,
    detail: health.ok
      ? `يستجيب${health.contentType ? ` — ${health.contentType}` : ""}${
          health.bytes ? ` — ${Math.round((health.bytes / (1024 * 1024)) * 10) / 10} ميجابايت` : ""
        }`
      : health.reason
  });

  /**
   * What is actually inside the file.
   *
   * Everything up to here can pass on a video WhatsApp will not relay: it takes the upload, accepts
   * the send, and declines to deliver, which looks exactly like success. The codec is the last thing
   * left that can differ between a video that arrives and one that does not.
   */
  try {
    const file = await fetch(signed);
    const report = inspectMp4(new Uint8Array(await file.arrayBuffer()));

    steps.push({
      name: "محتوى الملف",
      ok: report.problems.length === 0,
      detail:
        report.problems.length > 0
          ? report.problems.join(" ")
          : `سليم — فيديو ${report.videoCodec ?? "غير معروف"}${report.audioCodec ? ` وصوت ${report.audioCodec}` : ""}`
    });
  } catch (error) {
    steps.push({
      name: "محتوى الملف",
      ok: false,
      detail: `تعذّرت قراءة الملف: ${error instanceof Error ? error.message : String(error)}`
    });
  }

  // Reported separately from the send, because these fail for entirely different reasons and the
  // whole point of this page is to say which half broke.
  let mediaId: string | null = null;

  try {
    mediaId = await uploadMetaVideo(signed);
    steps.push({
      name: "رفع الملف إلى ميتا",
      ok: Boolean(mediaId),
      detail: mediaId ? `تم — المعرّف ${mediaId}` : "لم يُرفع — تعذّر قراءة الملف من التخزين."
    });
  } catch (error) {
    steps.push({
      name: "رفع الملف إلى ميتا",
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  // Attempted even when the checks failed: the point is to see what Meta says, and a check that is
  // wrong about a working file would otherwise never be caught.
  try {
    await metaWhatsAppProvider.sendVideo(target, signed);
    steps.push({ name: "إرسال الفيديو عبر ميتا", ok: true, detail: "قبلته ميتا. راجع واتساب الآن." });
  } catch (error) {
    steps.push({
      name: "إرسال الفيديو عبر ميتا",
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  return NextResponse.json({ ok: steps.every((step) => step.ok), target, steps });
}
