/**
 * Checks how a referral code is found in a message. Runs offline: `npm run check:parse`.
 *
 * This decides whether a marketer gets credited. The invite link prefills a greeting and the code,
 * because a bare code looks like junk in the message box and gets cleared before sending -- so the
 * code has to be found inside a sentence. The risk on the other side is reading an ordinary message
 * as a referral, which would attach a new user to a marketer who never invited them.
 */
import { findReferralCode } from "../src/lib/conversation/referral-code";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

// What the link itself prefills today.
check("the prefilled greeting and code", findReferralCode("سلام A7K2"), "A7K2");

// What someone might send after editing it, or typing by hand.
check("a fuller greeting", findReferralCode("السلام عليكم A7K2"), "A7K2");
check("with a comma", findReferralCode("سلام، A7K2"), "A7K2");
check("with the word code", findReferralCode("كودي A7K2"), "A7K2");
check("with a colon", findReferralCode("الكود: A7K2"), "A7K2");
check("an english opener", findReferralCode("hello A7K2"), "A7K2");
check("lowercase is normalised", findReferralCode("سلام a7k2"), "A7K2");

// Links already in circulation must keep working.
check("the old ابدأ form", findReferralCode("ابدأ A7K2"), "A7K2");
check("the bare code alone", findReferralCode("A7K2"), "A7K2");
check("a bare code with spaces around it", findReferralCode("  A7K2  "), "A7K2");

/**
 * The other half: a code always carries a letter, which is what separates it from the plain four
 * digit things people send -- a listing number and a result index.
 */
check("a listing number is not a code", findReferralCode("0007"), undefined);
check("an all digit token is not a code", findReferralCode("سلام 2345"), undefined);
check("a greeting alone is not a code", findReferralCode("السلام عليكم"), undefined);
check("a renter searching is not a code", findReferralCode("ابغى دار في تفرغ زينة"), undefined);
check("an empty message is not a code", findReferralCode(""), undefined);
check("a bare number is not a code", findReferralCode("3"), undefined);

// A four character word in an ordinary sentence must not be taken as a code just for being there.
check("an unrelated sentence is not a code", findReferralCode("عندي دار للايجار في لكصر"), undefined);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
