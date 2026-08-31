import { NextResponse } from "next/server";
import { aiExtractMessage } from "@/lib/conversation/ai-extract";
import { extractMessage } from "@/lib/conversation/extract";

export const dynamic = "force-dynamic";

/**
 * Answers whether GPT is actually running the bot.
 *
 * It cannot be told apart from the outside. When the OpenAI call fails, aiExtractMessage returns
 * null and the engine quietly falls back to the keyword extractor, so the bot keeps answering and
 * nothing looks broken -- the failure only ever reached a console.error in the Vercel logs.
 *
 * The probe is a sentence the keyword extractor provably cannot parse: it carries a district, a
 * room count and a ceiling price in one dialect phrase with none of the trigger words. If the fields
 * come back filled, the answer came from GPT and from nothing else.
 */
const probe = "نبغي دار فيها ثلاث غرف في تفرغ زينة وما تتجاوز خمسين الف";

export async function POST() {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({
      ok: false,
      configured: false,
      message:
        "OPENAI_API_KEY غير موجود في متغيرات البيئة. البوت يعمل الآن بالكلمات المفتاحية فقط: يفهم التحية والعبارات المحفوظة، ولا يفهم الجمل الحرة."
    });
  }

  const startedAt = Date.now();
  const ai = await aiExtractMessage(probe, ["تفرغ زينة", "لكصر", "عرفات"]);
  const took = Date.now() - startedAt;

  if (!ai) {
    return NextResponse.json({
      ok: false,
      configured: true,
      tookMs: took,
      message:
        "المفتاح موجود لكن الطلب فشل — غالبًا رصيد منتهٍ أو مفتاح ملغى. البوت يعمل الآن بالكلمات المفتاحية فقط. افتح سجلات Vercel وابحث عن «AI extract» لترى نص الخطأ."
    });
  }

  // The same sentence through the keyword path, so the answer shows the difference rather than
  // asserting it: this is what the bot would understand with GPT down.
  const local = extractMessage(probe);

  return NextResponse.json({
    ok: true,
    configured: true,
    tookMs: took,
    probe,
    ai: { intent: ai.intent, area: ai.area ?? null, rooms: ai.rooms ?? null, maxPrice: ai.maxPrice ?? null },
    local: { intent: local.intent, area: local.area ?? null, rooms: local.rooms ?? null, maxPrice: local.maxPrice ?? null },
    message: `GPT يعمل. رد خلال ${took} مللي ثانية.`
  });
}
