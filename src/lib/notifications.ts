import { getServiceSupabase } from "@/lib/supabase/server";
import { getWhatsAppProvider } from "@/lib/whatsapp/provider";
import { sendMetaTemplate } from "@/lib/whatsapp/meta";

/** What triggered a message, so the log can be read without deciphering the text. */
export type NotificationKind =
  | "admin_alert"
  | "listing_approved"
  | "listing_rejected"
  | "listing_submitted"
  | "topup_request"
  | "topup_approved"
  | "contact_released"
  | "referral_commission"
  | "referral_signup"
  | "balance_credited"
  | "withdrawal_approved"
  | "withdrawal_rejected"
  | "withdrawal_paid"
  | "property_rented"
  | "listing_refresh"
  | "admin_broadcast"
  | "bot_reply"
  | "test";

export const notificationLabels: Record<NotificationKind, string> = {
  admin_alert: "تنبيه للإدارة",
  listing_approved: "موافقة على إعلان",
  listing_rejected: "رفض إعلان",
  listing_submitted: "إرسال إعلان للمراجعة",
  topup_request: "طلب شحن رصيد",
  topup_approved: "اعتماد شحن رصيد",
  contact_released: "إرسال رقم المؤجر",
  referral_commission: "عمولة إحالة",
  referral_signup: "تسجيل عبر رابط دعوة",
  balance_credited: "إضافة رصيد",
  withdrawal_approved: "موافقة على سحب",
  withdrawal_rejected: "رفض سحب",
  withdrawal_paid: "تأكيد تحويل",
  property_rented: "إشعار تأجير الدار",
  listing_refresh: "تذكير بمراجعة الإعلانات",
  admin_broadcast: "رسالة جماعية",
  bot_reply: "رد البوت",
  test: "رسالة اختبار"
};

// Meta answers with a code and an English sentence. These are the ones that actually come up, turned
// into the action an admin has to take.
const metaErrorHelp: Array<{ code: number; help: string }> = [
  {
    code: 131030,
    help: "رقم واتساب الأعمال ما زال في وضع التطوير، وMeta لا تسمح بالإرسال إلا لأرقام مضافة يدويًا. أضف هذا الرقم في Meta for Developers ← WhatsApp ← API Setup ← قائمة أرقام المستلمين، أو أكمل توثيق الحساب لتشغيله بشكل كامل."
  },
  {
    code: 131047,
    help: "مرت أكثر من 24 ساعة منذ آخر رسالة أرسلها هذا الرقم للبوت، وواتساب يمنع الرسائل الحرة بعدها. الحل الدائم هو إرسال هذا الإشعار عبر قالب معتمد من Meta."
  },
  {
    code: 131026,
    help: "الرقم غير مسجل في واتساب أو لا يستقبل رسائل من الأعمال."
  },
  {
    code: 190,
    help: "توكن Meta منتهي الصلاحية. جدّد META_WHATSAPP_TOKEN في متغيرات البيئة."
  },
  {
    code: 131056,
    help: "أرسلنا رسائل كثيرة لهذا الرقم في وقت قصير. أعد المحاولة بعد قليل."
  }
];

/** Turns a raw provider error into the action an admin can take, keeping the original text. */
export function explainSendError(raw: string) {
  const match = metaErrorHelp.find(
    (item) => raw.includes(`(#${item.code})`) || raw.includes(`"code":${item.code}`)
  );

  return match ? `${match.help}\n\nنص الخطأ: ${raw}` : raw;
}

/** True when the failure is WhatsApp refusing free-form text outside the 24-hour window. */
export function isOutsideServiceWindow(raw: string | null | undefined) {
  return Boolean(raw && (raw.includes("(#131047)") || raw.includes('"code":131047')));
}

async function record(phone: string, kind: NotificationKind, body: string, status: "sent" | "failed", error?: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return;
  }

  const { error: logError } = await supabase.from("notification_log").insert({
    phone,
    kind,
    // Bounded so a long message cannot bloat the table; the opening lines identify it well enough.
    body: body.slice(0, 500),
    status,
    error: error?.slice(0, 1000) ?? null
  });

  if (logError) {
    console.error("Failed to write the notification log", logError);
  }
}

/**
 * Sends a WhatsApp message and records the outcome.
 *
 * Never throws. Callers are flows that must carry on regardless -- an admin approving a listing
 * should not see an error because the owner's phone is unreachable -- which is exactly why the
 * failure has to be written down somewhere an admin will actually look.
 */
export type TemplateFallback = {
  /** Name of an approved template in WhatsApp Manager. */
  name: string;
  /** Language code exactly as the template was created, e.g. "ar". A mismatch is rejected. */
  language: string;
  /** One value per {{n}} placeholder, in order. None may be empty. */
  parameters: string[];
};

export type SendResult =
  | { ok: true; viaTemplate?: boolean }
  | { ok: false; error: string; explained: string };

export async function sendNotification(
  phone: string,
  body: string,
  kind: NotificationKind,
  templateFallback?: TemplateFallback
): Promise<SendResult> {
  try {
    await getWhatsAppProvider().sendText(phone, body);
    await record(phone, kind, body, "sent");

    return { ok: true as const };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);

    /**
     * Free-form text is tried first on purpose: inside the 24-hour window it is free, carries the
     * full message rather than a fixed template, and needs no approval. The template is only for
     * the case that text cannot serve -- the window having closed -- and only for that failure,
     * since a bad token or an unreachable number would fail the template too.
     */
    if (isOutsideServiceWindow(raw) && templateFallback) {
      try {
        await sendMetaTemplate(phone, templateFallback.name, templateFallback.language, templateFallback.parameters);
        await record(phone, kind, `[قالب ${templateFallback.name}] ${body}`, "sent");

        return { ok: true as const, viaTemplate: true as const };
      } catch (templateError) {
        const templateRaw = templateError instanceof Error ? templateError.message : String(templateError);

        console.error(`Template fallback failed (${kind}) to ${phone}`, templateRaw);
        await record(phone, kind, body, "failed", `${raw}\n\nوفشل القالب أيضًا: ${templateRaw}`);

        return { ok: false as const, error: templateRaw, explained: explainSendError(templateRaw) };
      }
    }

    console.error(`Notification failed (${kind}) to ${phone}`, raw);
    await record(phone, kind, body, "failed", raw);

    return { ok: false as const, error: raw, explained: explainSendError(raw) };
  }
}

/**
 * Sends a video and records the outcome, falling back to a link when it cannot be sent.
 *
 * Deliberately without a caption. A caption box is narrower than a message bubble and wraps on its
 * own terms, which left the "1" of "اكتب: 1" stranded alone on a line; the instruction is sent as
 * its own message instead, arriving right behind the video.
 *
 * The fallback is the other half. Meta fetches the link itself and refuses anything past its size
 * limit, and a renter who asked to see the house and got nothing has no way of knowing whether to
 * wait or to ask again -- so a failure becomes a link, which at least plays in a browser. Callers
 * get told which one happened.
 */
export async function sendVideoNotification(
  phone: string,
  link: string,
  kind: NotificationKind
): Promise<{ ok: boolean; viaLink: boolean }> {
  const logged = "[فيديو] فيديو الدار";

  try {
    await getWhatsAppProvider().sendVideo(phone, link);
    await record(phone, kind, logged, "sent");

    return { ok: true, viaLink: false };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);

    console.error(`Video send failed (${kind}) to ${phone}`, raw);

    const fallback = await sendNotification(phone, `🎥 فيديو الدار:\n${link}`, kind);

    if (!fallback.ok) {
      await record(phone, kind, logged, "failed", raw);
    }

    return { ok: fallback.ok, viaLink: fallback.ok };
  }
}
