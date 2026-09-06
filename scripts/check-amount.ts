/**
 * Checks how an amount is read. Runs offline: `npm run check:amount`.
 *
 * "50 الف" is how a rent is said out loud; typing five zeros is what someone does only when a form
 * insists. A bot that understands one and not the other is one people learn to fight, and the ones
 * who do not learn stop answering. A rent misread by a factor of a thousand is the worst kind of
 * wrong, so the multiplier is only believed about numbers small enough to have meant it.
 */
import { parseAmount, parseRent } from "../src/lib/amount";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

check("a plain number is itself", parseAmount("50000"), 50000);
check("with words around it", parseAmount("الإيجار 45000 في الشهر"), 45000);

// The form people actually use.
check("50 الف is fifty thousand", parseAmount("50 الف"), 50000);
check("with no space", parseAmount("50الف"), 50000);
check("spelled with hamza", parseAmount("50 ألف"), 50000);
check("in the plural", parseAmount("12 الاف"), 12000);
check("inside a sentence", parseAmount("الإيجار 45 الف في الشهر"), 45000);
check("followed by the currency", parseAmount("70 الف اوقية"), 70000);
check("and the Latin shorthand", parseAmount("50k"), 50000);
check("millions too", parseAmount("2 مليون"), 2000000);

/**
 * Someone who typed the zeros and the word both meant the number they typed. Reading it as fifty
 * million would put a house on the books at a price nobody meant, and nothing downstream would
 * question it.
 */
check("zeros and the word together keep the number", parseAmount("50000 الف"), 50000);

// A multiplier has to belong to the number, not merely appear after it.
check("a distant الف is not a multiplier", parseAmount("50 دار في الف مكان"), 50);

// Eastern digits are not written here, and are not read anywhere else either.
check("eastern digits are not read", parseAmount("٥٠ الف"), undefined);

check("no number at all", parseAmount("لا يوجد"), undefined);
check("an empty answer", parseAmount(""), undefined);
check("zero is a number, not an absence", parseAmount("0"), 0);
check("a room count is left alone", parseAmount("3"), 3);

/**
 * A rent is said in thousands whether or not the zeros are typed.
 *
 * Two thirds of the real answers arrived as "60" and "70", and reading them literally put rents of
 * sixty and seventy ouguiya on the sheet -- a column nobody can read, whatever the layout around it.
 * Only the fields holding money may assume this: a room count of 3 has to stay 3.
 */
check("a bare 60 is sixty thousand", parseRent("60"), 60000);
check("and 100 is a hundred thousand", parseRent("100"), 100000);
check("a number already in thousands is left alone", parseRent("70000"), 70000);
check("and one written in words too", parseRent("70 الف"), 70000);
check("the boundary itself is not multiplied", parseRent("1000"), 1000);
check("zero stays zero", parseRent("0"), 0);
check("and nothing stays nothing", parseRent("لا أعرف"), undefined);
check("a room count is not a rent", parseAmount("3"), 3);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
