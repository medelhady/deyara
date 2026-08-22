import { NextResponse } from "next/server";
import { setWithdrawalStatus, type WithdrawalStatus } from "@/lib/admin-actions";

export const dynamic = "force-dynamic";

const allowedStatuses: WithdrawalStatus[] = ["approved", "rejected", "paid"];

function isAllowed(status: string): status is WithdrawalStatus {
  return (allowedStatuses as string[]).includes(status);
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json();
  const status = String(body.status ?? "");

  if (!isAllowed(status)) {
    return NextResponse.json({ error: "Invalid withdrawal status." }, { status: 400 });
  }

  // The rules, the points and the message to the marketer live in setWithdrawalStatus so this route
  // and the WhatsApp command cannot drift apart.
  const result = await setWithdrawalStatus(params.id, status, String(body.admin_note ?? ""));

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.reason === "not_found" ? 404 : 400 });
  }

  return NextResponse.json({ withdrawal: result.data?.withdrawal });
}
