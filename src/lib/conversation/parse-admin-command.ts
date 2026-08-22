/**
 * Reads an admin's WhatsApp message and says which command it is, without touching the database.
 *
 * Order matters more than it looks. "رفض سحب 22245678901" and "رفض 0007" open with the same word,
 * so the withdrawal form has to be recognised first or the generic one swallows it and treats
 * "سحب" as a listing code. Keeping the decision here, separate from the work each command does,
 * is what makes that testable.
 */
export type AdminCommand =
  | { kind: "help" }
  | { kind: "approveListing"; code: string }
  | { kind: "rejectListing"; code: string; reason: string }
  | { kind: "topup"; phone: string; points: number }
  | { kind: "listWithdrawals" }
  | { kind: "payWithdrawal"; phone: string }
  | { kind: "rejectWithdrawal"; phone: string; reason: string };

export function parseAdminCommand(body: string): AdminCommand | null {
  const text = body.trim();

  if (!text) {
    return null;
  }

  if (/^(اوامر|أوامر|اوامر الادارة|مساعدة الادارة)$/i.test(text)) {
    return { kind: "help" };
  }

  if (/^(?:سحوبات|السحوبات|طلبات السحب)$/i.test(text)) {
    return { kind: "listWithdrawals" };
  }

  // The digits are matched greedily so they cannot stop after the first one and hand the rest of the
  // number to the reason. A reason that itself opens with a digit would be absorbed, which is the
  // same trade the top-up command already makes.
  const rejectWithdrawal = text.match(/^(?:رفض)\s+سحب\s+(\+?[\d\s]+)(.*)$/);

  if (rejectWithdrawal) {
    return {
      kind: "rejectWithdrawal",
      phone: rejectWithdrawal[1].trim(),
      reason: rejectWithdrawal[2]?.trim() ?? ""
    };
  }

  const payWithdrawal = text.match(/^(?:دفع|تحويل)\s+(\+?[\d\s]+)$/);

  if (payWithdrawal) {
    return { kind: "payWithdrawal", phone: payWithdrawal[1].trim() };
  }

  const topup = text.match(/^(?:شحن|اضافة نقاط|إضافة نقاط)\s+(\+?[\d\s]+?)\s+(\d{1,7})\s*$/);

  if (topup) {
    return { kind: "topup", phone: topup[1].trim(), points: Number(topup[2]) };
  }

  const approve = text.match(/^(?:قبول|موافقة|اعتماد)\s+(\S+)\s*$/);

  if (approve) {
    return { kind: "approveListing", code: approve[1] };
  }

  const reject = text.match(/^(?:رفض)\s+(\S+)\s*(.*)$/);

  if (reject) {
    return { kind: "rejectListing", code: reject[1], reason: reject[2]?.trim() ?? "" };
  }

  return null;
}
