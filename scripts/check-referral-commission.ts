/**
 * Checks how much commission a top-up earns a referrer. Runs offline: `npm run check:referral`.
 *
 * This decides real payouts to marketers. The rules interact -- a minimum top-up, an expiry window
 * counted in months, and a percentage that rounds down -- and none of them were covered before.
 */
import { commissionForTopup } from "../src/lib/referral";

const now = new Date("2026-08-22T12:00:00Z");

const base = {
  points: 1000,
  commissionPercent: 30,
  windowMonths: 12,
  minTopupPoints: 0,
  referredAt: "2026-01-01T00:00:00Z",
  now
};

let failures = 0;

function check(name: string, actual: number, expected: number) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

check("30% of 1000 inside the window", commissionForTopup(base), 300);

check(
  "rounds down rather than paying a fraction",
  commissionForTopup({ ...base, points: 101, commissionPercent: 30 }),
  30
);

check(
  "a top-up too small to round up to a point pays nothing",
  commissionForTopup({ ...base, points: 3, commissionPercent: 30 }),
  0
);

check("zero percent pays nothing", commissionForTopup({ ...base, commissionPercent: 0 }), 0);

check(
  "below the minimum top-up pays nothing",
  commissionForTopup({ ...base, points: 400, minTopupPoints: 500 }),
  0
);

check(
  "exactly the minimum top-up still pays",
  commissionForTopup({ ...base, points: 500, minTopupPoints: 500 }),
  150
);

check(
  "a minimum of zero counts every top-up",
  commissionForTopup({ ...base, points: 1, commissionPercent: 100, minTopupPoints: 0 }),
  1
);

// The window is counted from the day the referred person joined, not from their first top-up.
check(
  "past the window pays nothing",
  commissionForTopup({ ...base, referredAt: "2025-01-01T00:00:00Z" }),
  0
);

check(
  "the day before expiry still pays",
  commissionForTopup({ ...base, referredAt: "2025-08-23T00:00:00Z" }),
  300
);

check(
  "a window of zero months disables the expiry entirely",
  commissionForTopup({ ...base, referredAt: "2020-01-01T00:00:00Z", windowMonths: 0 }),
  300
);

check(
  "no join date leaves the window unenforced",
  commissionForTopup({ ...base, referredAt: null }),
  300
);

// Losing money because a timestamp could not be parsed would be the wrong way to fail.
check(
  "an unreadable join date still pays",
  commissionForTopup({ ...base, referredAt: "not a date" }),
  300
);

check("a zero top-up pays nothing", commissionForTopup({ ...base, points: 0 }), 0);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
