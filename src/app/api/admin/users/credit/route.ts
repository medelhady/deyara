import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { creditWalletManually } from "@/lib/admin-actions";
import { sessionCookieName, verifySessionToken } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as { phone?: string; points?: number | string; note?: string };

  // Recorded on the ledger row so a balance change can be traced back to whoever made it.
  const session = await verifySessionToken(cookies().get(sessionCookieName)?.value);

  const result = await creditWalletManually(
    String(body.phone ?? ""),
    Number(body.points ?? 0),
    String(body.note ?? ""),
    session?.phone ?? null
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({ message: result.message, ...result.data });
}
