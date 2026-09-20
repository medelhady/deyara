import { NextResponse } from "next/server";
import { listCampaigns } from "@/lib/campaigns";
import { describeStoredVideo, relabelStoredVideo, signPropertyMedia } from "@/lib/whatsapp/media";
import { mediaKindLabels } from "@/lib/media-kinds";
import { sendMediaNotification, sendNotification, sendVideoNotification } from "@/lib/notifications";
import { checkVideoUrl } from "@/lib/video-health";

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

  /**
   * The first thing to establish, and the one nobody thinks to check.
   *
   * A file uploaded into the form but never saved with the campaign leaves the row with nothing
   * attached -- and from the outside that is indistinguishable from a file WhatsApp refused. Said
   * here in one line, before anything else is attempted.
   */
  if (campaign.attachments.length === 0) {
    steps.push("⚠️ هذه الحملة محفوظة بلا مرفقات — ارفع الملف ثم اضغط «احفظ التعديل» ليُحفظ معها.");
  }

  for (const attachment of campaign.attachments) {
    const described = mediaKindLabels[attachment.kind].label;

    /**
     * The video keeps its own inspection.
     *
     * Its failures are the expensive ones -- H.265 accepted by Meta and silently never delivered,
     * a .mov label refused outright -- and both are fixable here, while someone is still watching.
     */
    if (attachment.kind === "video") {
      const file = await describeStoredVideo(attachment.path);

      if (!file.found) {
        return NextResponse.json({ error: file.error, steps }, { status: 400 });
      }

      steps.push(`الفيديو: MB ميجابايت، TYPE، فيديو VC، صوت AC.`
        .replace("MB", String(file.megabytes))
        .replace("TYPE", file.contentType)
        .replace("VC", file.videoCodec)
        .replace("AC", file.audioCodec));

      if (file.problems.length > 0) {
        return NextResponse.json({ error: file.problems.join(" "), steps }, { status: 400 });
      }

      if (file.contentType !== "video/mp4") {
        const relabelled = await relabelStoredVideo(attachment.path);

        steps.push(
          relabelled.ok
            ? `✅ صحّحت نوع الملف من TYPE إلى video/mp4 — واتساب لا يقبل غيره.`.replace("TYPE", file.contentType)
            : `⚠️ تعذر تصحيح نوع الملف: REASON`.replace("REASON", relabelled.error ?? "")
        );
      }
    }

    const link = await signPropertyMedia(attachment.path);

    if (!link) {
      steps.push(`❌ تعذر توقيع رابط KIND من التخزين.`.replace("KIND", described));
      continue;
    }

    if (attachment.kind === "video") {
      const health = await checkVideoUrl(link);

      steps.push(health.ok ? `الرابط: يعمل (TYPE).`.replace("TYPE", health.contentType ?? "-") : `⚠️ الرابط: REASON`.replace("REASON", health.reason));

      const sent = await sendVideoNotification(to, link, "admin_alert", campaign.name);

      // The distinction the log alone does not make plain: a link that arrived is a video that did not.
      steps.push(
        sent.ok && !sent.viaLink
          ? "✅ وصل الفيديو كفيديو."
          : sent.ok
            ? "⚠️ لم يقبل واتساب الفيديو، فأُرسل كرابط نصي. راجع سجل الإشعارات للسبب."
            : "❌ لم يصل الفيديو ولا الرابط. راجع سجل الإشعارات."
      );

      continue;
    }

    const sent = await sendMediaNotification(to, attachment.kind, link, "admin_alert", {
      fileName: attachment.name,
      label: campaign.name
    });

    steps.push(
      sent.ok && !sent.viaLink
        ? `✅ وصلت KIND.`.replace("KIND", described)
        : sent.ok
          ? `⚠️ لم يقبل واتساب KIND، فأُرسلت كرابط نصي.`.replace("KIND", described)
          : `❌ لم تصل KIND. راجع سجل الإشعارات.`.replace("KIND", described)
    );
  }

  if (campaign.replyText.trim()) {
    const text = await sendNotification(to, campaign.replyText, "admin_alert");

    steps.push(text.ok ? "✅ وصل النص." : `❌ لم يصل النص: REASON`.replace("REASON", text.explained));
  }

  return NextResponse.json({ ok: true, steps });
}
