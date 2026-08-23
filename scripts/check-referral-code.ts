/**
 * Checks referral codes. Runs offline: `npm run check:code`.
 *
 * The invite link now prefills the bare code, so the code alone has to be distinguishable from the
 * other four character things a user types: a listing number and a result index, both plain digits.
 * The letter is what separates them. A code without one is rejected on arrival, which means the
 * marketer's invites register nobody and nothing anywhere reports it.
 */
import { isUsableReferralCode } from "../src/lib/conversation/engine";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

check("a code with letters is usable", isUsableReferralCode("A7K2"), true);
check("all letters is usable", isUsableReferralCode("ABCD"), true);
check("one letter is enough", isUsableReferralCode("2K34"), true);

// The whole point: these are indistinguishable from a listing number or a result index.
check("all digits is not usable", isUsableReferralCode("2345"), false);
check("a listing number is not a code", isUsableReferralCode("0007"), false);

check("three characters is not a code", isUsableReferralCode("A7K"), false);
check("five characters is not a code", isUsableReferralCode("A7K23"), false);
check("lowercase is not stored form", isUsableReferralCode("a7k2"), false);
check("punctuation is not a code", isUsableReferralCode("A7-2"), false);
check("empty is not a code", isUsableReferralCode(""), false);
check("null is not a code", isUsableReferralCode(null), false);
check("undefined is not a code", isUsableReferralCode(undefined), false);
check("arabic text is not a code", isUsableReferralCode("ابدأ"), false);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
