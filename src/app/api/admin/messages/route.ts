import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readMessageRows, saveMessage } from "@/lib/bot-messages";
import { sessionCookieName, verifySessionToken } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    { messages: await readMessageRows() },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}

export async function PUT(request: Request) {
  const body = (await request.json()) as { key?: string; body?: string };
  const session = await verifySessionToken(cookies().get(sessionCookieName)?.value);

  const result = await saveMessage(String(body.key ?? ""), String(body.body ?? ""), session?.phone ?? null);

  if (!result.saved) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, messages: await readMessageRows() });
}
