import { NextResponse } from "next/server";
import { audienceLabels, isAudience, reachableNow, resolveAudience } from "@/lib/broadcast";
import { sendNotification } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * How many recipients one request handles.
 *
 * Sending is sequential and each send is a network round trip, so a large audience would outlast
 * the function timeout and leave the caller unable to tell who had already been messaged. The page
 * sends in batches and shows progress instead.
 */
const batchSize = 25;

export async function GET(request: Request) {
  const audience = new URL(request.url).searchParams.get("audience") ?? "all";

  if (!isAudience(audience)) {
    return NextResponse.json({ error: "فئة غير معروفة." }, { status: 400 });
  }

  const phones = await resolveAudience(audience);
  const reachable = await reachableNow(phones);

  return NextResponse.json(
    {
      audience,
      label: audienceLabels[audience],
      total: phones.length,
      reachable: reachable.length,
      // Everyone else needs an approved Marketing template and consent to receive one.
      unreachable: phones.length - reachable.length
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as { audience?: string; body?: string; offset?: number };
  const audience = String(body.audience ?? "");
  const text = String(body.body ?? "").trim();
  const offset = Number(body.offset ?? 0);

  if (!isAudience(audience)) {
    return NextResponse.json({ error: "فئة غير معروفة." }, { status: 400 });
  }

  if (text.length < 2) {
    return NextResponse.json({ error: "اكتب نص الرسالة أولًا." }, { status: 400 });
  }

  const phones = await resolveAudience(audience);

  // Only those inside the window are attempted. Sending to the rest would burn one of the 250 daily
  // business-initiated conversations per person and fail anyway, and a stream of refusals is what
  // drags a number's quality rating down.
  const reachable = await reachableNow(phones);
  const slice = reachable.slice(offset, offset + batchSize);

  let sent = 0;
  const failures: Array<{ phone: string; error: string }> = [];

  for (const phone of slice) {
    const result = await sendNotification(phone, text, "admin_broadcast");

    if (result.ok) {
      sent += 1;
    } else {
      failures.push({ phone, error: result.explained ?? result.error });
    }
  }

  const nextOffset = offset + slice.length;

  return NextResponse.json({
    total: reachable.length,
    skipped: phones.length - reachable.length,
    processed: nextOffset,
    sent,
    failures,
    done: nextOffset >= reachable.length
  });
}
