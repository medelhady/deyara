import { NextResponse } from "next/server";
import { endHandover, getHandover, startHandover } from "@/lib/handover";

export const dynamic = "force-dynamic";

/**
 * Gives one conversation back to the bot, or takes it by hand.
 *
 * A reply from the dashboard hands it over on its own, so the usual use of this is the other
 * direction: the exchange is finished and the bot should answer this number again without waiting
 * out the twelve hours.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { phone?: string; active?: boolean };
  const phone = String(body.phone ?? "").trim();

  if (!phone) {
    return NextResponse.json({ error: "لم تحدد رقمًا." }, { status: 400 });
  }

  if (body.active === false) {
    const result = await endHandover(phone);

    if (!result.ended) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, handover: await getHandover(phone) });
  }

  await startHandover(phone);

  return NextResponse.json({ ok: true, handover: await getHandover(phone) });
}
