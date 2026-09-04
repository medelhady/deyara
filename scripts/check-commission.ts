/**
 * Checks how the office commission is written out. Runs offline: `npm run check:commission`.
 *
 * The setting used to take a whole sentence, which produced a heading and a sentence repeating it,
 * and the same text was typed a second time into the notices field so renters saw it twice. It now
 * holds an amount and the wording lives in the code -- but sentences already saved must keep
 * working, because production migrates one box at a time.
 */
import { formatCommission, commissionLines, isPlainAmount, commissionNote } from "../src/lib/commission";
import { resolveAreaNote } from "../src/lib/conversation/engine";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

// The shape the field now writes.
check("a plain amount is formatted", formatCommission("12000"), "12,000 أوقية");
check("and recognised as an amount", isPlainAmount("12000"), true);
check("it carries the explanation", commissionLines("12000").length, 2);
check("the amount comes first", commissionLines("12000")[0], "12,000 أوقية");
check("the note comes second", commissionLines("12000")[1], commissionNote);

// Digits typed with separators are still an amount, not a sentence.
check("a thousands separator is tolerated", formatCommission("12,000"), "12,000 أوقية");
check("so are stray spaces", formatCommission(" 8000 "), "8,000 أوقية");

// A sentence saved before the change must survive untouched, with no invented note after it.
const legacy = "المستأجر يدفع 12 الف للمكتب بعد الاتفاق على الايجار";

check("a legacy sentence is not an amount", isPlainAmount(legacy), false);
check("it is passed through unchanged", formatCommission(legacy), legacy);
check("and gets no second line bolted on", commissionLines(legacy).length, 1);

// Nothing set hides the line everywhere, which is what the empty-string setting means.
check("an empty setting renders nothing", formatCommission(""), "");
check("and produces no lines at all", commissionLines("").length, 0);
check("whitespace counts as empty", commissionLines("   ").length, 0);
check("whitespace is not an amount", isPlainAmount("   "), false);

// The per-district JSON the field writes has to resolve before formatting.
const stored = JSON.stringify([
  { text: "12000", areas: [] },
  { text: "15000", areas: ["تفرغ زينة"] }
]);

check("the district override wins", formatCommission(resolveAreaNote(stored, "تفرغ زينة")), "15,000 أوقية");
check("another district takes the default", formatCommission(resolveAreaNote(stored, "لكصر")), "12,000 أوقية");
check("an unknown district takes the default too", formatCommission(resolveAreaNote(stored, "نواذيبو")), "12,000 أوقية");

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
