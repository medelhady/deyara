import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { getWhatsAppProvider } from "@/lib/whatsapp/provider";

export const dynamic = "force-dynamic";

// Meta returns a code and an English sentence. These are the ones that actually come up, turned into
// the action an admin has to take.
const metaErrorHelp: Array<{ code: number; help: string }> = [
  {
    code: 131030,
    help: "رقم واتساب الأعمال ما زال في وضع التطوير، وMeta لا تسمح بالإرسال إلا لأرقام مضافة يدويًا. أضف هذا الرقم في Meta for Developers ← WhatsApp ← API Setup ← قائمة أرقام المستلمين، أو أكمل توثيق الحساب لتشغيله بشكل كامل."
  },
  {
    code: 131047,
    help: "مرت أكثر من 24 ساعة منذ آخر رسالة أرسلها هذا الرقم للبوت، وواتساب يمنع الرسائل الحرة بعدها. أرسل أي رسالة من ذلك الرقم للبوت ثم أعد المحاولة، أو استخدم قالب رسائل معتمدًا من Meta."
  },
  {
    code: 131026,
    help: "الرقم غير مسجل في واتساب أو لا يستقبل رسائل من الأعمال."
  },
  {
    code: 190,
    help: "توكن Meta منتهي الصلاحية. جدّد META_WHATSAPP_TOKEN في متغيرات البيئة."
  }
];

function explainMetaError(raw: string) {
  const match = metaErrorHelp.find((item) => raw.includes(`(#${item.code})`) || raw.includes(`"code":${item.code}`));

  return match ? `${match.help}\n\nنص الخطأ: ${raw}` : raw;
}

/**
 * Sends one test notification and reports what actually happened per number. Real notifications are
 * fire-and-forget so a failure cannot break a conversation, which also makes them invisible; this is
 * where an admin finds out why nothing arrived.
 */
export async function POST() {
  const { adminNotifyNumbers } = await getSettings();
  const numbers = adminNotifyNumbers
    .split(",")
    .map((number) => number.trim())
    .filter(Boolean);

  if (numbers.length === 0) {
    return NextResponse.json({
      configured: false,
      message:
        "لا يوجد أي رقم في إعداد «أرقام تنبيهات الإدارة». احفظ رقمك أولًا، ولو كنت حفظته فتأكد أن جدول app_settings منشأ في قاعدة البيانات.",
      results: []
    });
  }

  const results = await Promise.all(
    numbers.map(async (number) => {
      const digits = number.replace("whatsapp:", "").replace(/\D/g, "");

      if (digits.length < 10) {
        return {
          number,
          ok: false,
          error: `الرقم "${number}" قصير. اكتبه بصيغة دولية كاملة مع رمز الدولة، مثل 22245678901.`
        };
      }

      try {
        await getWhatsAppProvider().sendText(
          number,
          [
            "🔔 *تنبيه تجريبي من الديارة*",
            "",
            "إذا وصلتك هذه الرسالة فتنبيهات الإدارة تعمل على هذا الرقم."
          ].join("\n")
        );

        return { number, ok: true, error: null };
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);

        return { number, ok: false, error: explainMetaError(raw) };
      }
    })
  );

  return NextResponse.json({ configured: true, results });
}
