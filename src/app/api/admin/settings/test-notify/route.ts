import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { metaWhatsAppProvider } from "@/lib/whatsapp/meta";

export const dynamic = "force-dynamic";

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
        await metaWhatsAppProvider.sendText(
          number,
          [
            "🔔 *تنبيه تجريبي من الديارة*",
            "",
            "إذا وصلتك هذه الرسالة فتنبيهات الإدارة تعمل على هذا الرقم."
          ].join("\n")
        );

        return { number, ok: true, error: null };
      } catch (error) {
        return { number, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    })
  );

  return NextResponse.json({ configured: true, results });
}
