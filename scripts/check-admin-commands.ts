/**
 * Checks how an admin's WhatsApp message is read. Runs offline: `npm run check:commands`.
 *
 * The commands share opening words -- "رفض 0007" rejects a listing, "رفض سحب 2224..." rejects a
 * withdrawal -- so the wrong precedence silently sends an admin's instruction to the wrong feature.
 * This project has already had one bug of exactly that shape.
 */
import { parseAdminCommand } from "../src/lib/conversation/parse-admin-command";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const pass = a === e;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}\n      expected ${e}\n      got      ${a}`);
}

check("help", parseAdminCommand("اوامر"), { kind: "help" });
check("help with hamza", parseAdminCommand("أوامر"), { kind: "help" });

check("approve a listing", parseAdminCommand("قبول 0007"), { kind: "approveListing", code: "0007" });

check("reject a listing with a reason", parseAdminCommand("رفض 0007 الفيديو غير واضح"), {
  kind: "rejectListing",
  code: "0007",
  reason: "الفيديو غير واضح"
});

check("reject a listing with no reason", parseAdminCommand("رفض 0007"), {
  kind: "rejectListing",
  code: "0007",
  reason: ""
});

check("credit a top-up", parseAdminCommand("شحن 22245678901 2000"), {
  kind: "topup",
  phone: "22245678901",
  points: 2000
});

check("list withdrawals", parseAdminCommand("سحوبات"), { kind: "listWithdrawals" });
check("list withdrawals, spelled out", parseAdminCommand("طلبات السحب"), { kind: "listWithdrawals" });

check("confirm a payout", parseAdminCommand("دفع 22245678901"), {
  kind: "payWithdrawal",
  phone: "22245678901"
});

// The case the ordering exists for: without it, "سحب" is read as a listing code.
check("reject a withdrawal, not a listing", parseAdminCommand("رفض سحب 22245678901"), {
  kind: "rejectWithdrawal",
  phone: "22245678901",
  reason: ""
});

check("reject a withdrawal with a reason", parseAdminCommand("رفض سحب 22245678901 الرصيد غير كافٍ"), {
  kind: "rejectWithdrawal",
  phone: "22245678901",
  reason: "الرصيد غير كافٍ"
});

check("surrounding spaces are ignored", parseAdminCommand("  قبول 0007  "), {
  kind: "approveListing",
  code: "0007"
});

// Anything that is not a command must fall through to the ordinary conversation untouched.
check("a renter searching is not a command", parseAdminCommand("ابغى دار في تفرغ زينة"), null);
check("a bare number is not a command", parseAdminCommand("3"), null);
check("empty text is not a command", parseAdminCommand(""), null);
check("whitespace is not a command", parseAdminCommand("   "), null);
check("the word reject alone is not a command", parseAdminCommand("رفض"), null);
check("the word pay alone is not a command", parseAdminCommand("دفع"), null);
check("a top-up without an amount is not a command", parseAdminCommand("شحن 22245678901"), null);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
