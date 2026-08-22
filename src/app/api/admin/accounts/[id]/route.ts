import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sessionCookieName, verifySessionToken } from "@/lib/admin-auth";
import { changeAccountPassword, deleteAccount, listAccounts, setAccountActive } from "@/lib/dashboard-accounts";

export const dynamic = "force-dynamic";

/**
 * Refuses changes that would leave nobody able to sign in: turning off or removing the last active
 * account, or your own. Locking the whole team out of the dashboard needs a database visit to undo.
 */
async function blocksLockout(id: string, action: "deactivate" | "delete") {
  const session = await verifySessionToken(cookies().get(sessionCookieName)?.value);
  const result = await listAccounts();

  if (!result.ok) {
    return result.error;
  }

  const target = result.accounts.find((account) => account.id === id);

  if (!target) {
    return "لم أجد هذا الحساب.";
  }

  if (session && target.phone === session.phone) {
    return action === "delete" ? "لا يمكنك حذف حسابك أنت." : "لا يمكنك إيقاف حسابك أنت.";
  }

  const otherActive = result.accounts.filter((account) => account.is_active && account.id !== id);

  if (target.is_active && otherActive.length === 0) {
    return "هذا آخر حساب فعّال. أضف حسابًا آخر قبل إيقافه أو حذفه.";
  }

  return null;
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = (await request.json()) as { isActive?: boolean; password?: string };

  if (typeof body.password === "string") {
    const result = await changeAccountPassword(params.id, body.password);

    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (typeof body.isActive === "boolean") {
    if (!body.isActive) {
      const problem = await blocksLockout(params.id, "deactivate");

      if (problem) {
        return NextResponse.json({ error: problem }, { status: 400 });
      }
    }

    const result = await setAccountActive(params.id, body.isActive);

    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ error: "لا يوجد تغيير مطلوب." }, { status: 400 });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const problem = await blocksLockout(params.id, "delete");

  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  const result = await deleteAccount(params.id);

  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: 400 });
}
