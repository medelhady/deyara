import { NextResponse } from "next/server";
import { listCampaigns } from "@/lib/campaigns";
import { describeStoredVideo, relabelStoredVideo, signPropertyMedia } from "@/lib/whatsapp/media";
import { sendNotification, sendVideoNotification } from "@/lib/notifications";

export const dynamic = "force-dynamic";
// The same budget as the webhook: this signs a link, reads the file, uploads it to Meta and sends.
export const maxDuration = 30;

/**
 * Sends one campaign to one number, and says exactly what happened.
 *
 * A video that does not arrive leaves nothing to look at: Meta accepts the send and decides later,
 * the log says "sent", and the admin is left comparing two identical-looking messages. This does the
 * real send and reports each step -- what the file is, whether it went as a video or fell back to a
 * link, and the reason if it did.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { id?: string; phone?: string };
  const id = String(body.id ?? "");
  const phone = String(body.phone ?? "").replace(/\D/g, "");

  if (!phone) {
    return NextResponse.json({ error: "اكتب رقمًا لإرسال التجربة إليه." }, { status: 400 });
  }

  const { campaigns, error } = await listCampaigns();

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const campaign = campaigns.find((item) => item.id === id);

  if (!campaign) {
    return NextResponse.json({ error: "لم أجد هذه الحملة." }, { status: 400 });
  }

  const to = `whatsapp:+${phone}`;
  const steps: string[] = [];

  if (campaign.videoPath) {
    const file = await describeStoredVideo(campaign.videoPath);

    if (!file.found) {
      return NextResponse.json({ error: file.error }, { status: 400 });
    }

    steps.push(`الملف: ${file.megabytes} ميجابايت، ${file.contentType}، فيديو ${file.videoCodec}، صوت ${file.audioCodec}.`);

    if (file.problems.length > 0) {
      return NextResponse.json({ error: file.problems.join(" "), steps }, { status: 400 });
    }

    /**
     * The label corrected in place, if it is wrong.
     *
     * WhatsApp refuses anything that is not video/mp4 or video/3gpp, and a phone exporting H.264
     * into a .mov calls it video/quicktime -- which is how a perfectly good video reached nobody.
     * Fixed here rather than by asking for a re-upload, since the file is already in the bucket.
     */
    if (file.contentType !== "video/mp4") {
      const relabelled = await relabelStoredVideo(campaign.videoPath);

      steps.push(
        relabelled.ok
          ? `✅ صحّحت نوع الملف من ${file.contentType} إلى video/mp4 — واتساب لا يقبل غيره.`
          : `⚠️ تعذر تصحيح نوع الملف: ${relabelled.error}`
      );
    }

    const link = await signPropertyMedia(campaign.videoPath);

    if (!link) {
      return NextResponse.json({ error: "تعذر توقيع رابط الفيديو من التخزين.", steps }, { status: 400 });
    }

    const sent = await sendVideoNotification(to, link, "admin_alert", campaign.name);

    // The distinction the log alone does not make plain: a link that arrived is a video that did not.
    steps.push(
      sent.ok && !sent.viaLink
        ? "✅ وصل الفيديو كفيديو."
        : sent.ok
          ? "⚠️ لم يقبل واتساب الفيديو، فأُرسل كرابط نصي. راجع سجل الإشعارات للسبب."
          : "❌ لم يصل الفيديو ولا الرابط. راجع سجل الإشعارات للسبب."
    );
  } else {
    steps.push("لا يوجد فيديو في هذه الحملة.");
  }

  if (campaign.replyText.trim()) {
    const text = await sendNotification(to, campaign.replyText, "admin_alert");

    steps.push(text.ok ? "✅ وصل النص." : `❌ لم يصل النص: ${text.explained}`);
  }

  return NextResponse.json({ ok: true, steps });
}
