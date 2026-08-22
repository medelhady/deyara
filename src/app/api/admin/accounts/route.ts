import { NextResponse } from "next/server";
import { sessionCookieName, verifySessionToken } from "@/lib/admin-auth";
import { createAccount, listAccounts } from "@/lib/dashboard-accounts";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await listAccounts();

  if (!result.ok) {
    return NextResponse.json({ error: result.error, missingTable: result.missingTable }, { status: 400 });
  }

  return NextResponse.json({ accounts: result.accounts });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { phone?: string; name?: string; password?: string };

  // Recorded so the accounts list shows who added whom.
  const session = await verifySessionToken(cookies().get(sessionCookieName)?.value);

  const result = await createAccount({
    phone: String(body.phone ?? ""),
    name: String(body.name ?? ""),
    password: String(body.password ?? ""),
    createdBy: session?.phone ?? null
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ account: result.account });
}
