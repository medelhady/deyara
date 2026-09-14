/**
 * Checks how a screenshot reading is cleaned before it can be saved. Runs offline:
 * `npm run check:offices`.
 *
 * Two things have to hold. A number written any of the ways people write it must come out as one
 * string, or the duplicate warning never fires and the same office is collected five times. And the
 * reader is a language model looking at a photograph: it can answer with a number where a string was
 * asked for, a string where a list was, or nothing at all -- none of which may reach the page as a
 * crash, because an empty draft that can be typed by hand always beats an error.
 */
import { cleanPhones, duplicatesAmong, normalizePhone, parseOfficeReading } from "../src/lib/offices";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

// The same number, written the five ways it appears in posts.
check("eight digits get the country code", normalizePhone("44112233"), "22244112233");
check("spaces do not matter", normalizePhone("44 11 22 33"), "22244112233");
check("dashes do not matter", normalizePhone("44-11-22-33"), "22244112233");
check("a written +222 is kept once", normalizePhone("+222 44112233"), "22244112233");
check("and 00222 is the same number", normalizePhone("0022244112233"), "22244112233");

// Anything that is not a number must not become a contact.
check("a price is not a phone number", normalizePhone("50000"), null);
check("nor is a view count", normalizePhone("1.2"), null);
check("nor is an empty string", normalizePhone(""), null);

// A foreign number is kept as written rather than forced into a Mauritanian shape.
check("a foreign number survives", normalizePhone("+33 6 12 34 56 78"), "33612345678");

// One office publishes the same number twice in one post as often as not.
check("repeats are removed", cleanPhones(["44112233", "+222 44112233"]).length, 1);
check("and the rest are kept in order", cleanPhones(["44112233", "36445566"]).join(","), "22244112233,22236445566");
check("junk is dropped rather than saved", cleanPhones(["50000", "44112233"]).length, 1);

// What the reader returns, in every shape it has actually returned it.
const good = parseOfficeReading({ name: " مكتب النور ", phones: ["44112233"], platform: "فيسبوك", note: "" });

check("the name is trimmed", good.name, "مكتب النور");
check("the phone is normalised", good.phones[0], "22244112233");
check("the platform survives", good.platform, "فيسبوك");

// A single number instead of a list, which is what comes back when the post has one contact.
check("one phone written alone is still a list", parseOfficeReading({ phone: "44112233" }).phones.length, 1);
check("a numeric phone is read, not dropped", parseOfficeReading({ phones: [44112233] }).phones.length, 1);

// Nothing at all: the page must open on an empty form, not an error.
check("an empty answer gives an empty draft", parseOfficeReading({}).name, "");
check("with no phones invented", parseOfficeReading({}).phones.length, 0);
check("and null is survivable", parseOfficeReading(null).name, "");
check("as is a string where an object was expected", parseOfficeReading("مكتب").name, "");

// A number that already belongs to another office: refused, so one agency is not called twice by
// two people reading two rows.
const stored = [
  { id: "1", name: "مكتب النور", phones: ["22244112233", "22236445566"] },
  { id: "2", name: "وكالة الواحة", phones: ["22247778899"] }
];

check("a fresh number is not a duplicate", duplicatesAmong(["22233221100"], stored).length, 0);
check("a number already stored is caught", duplicatesAmong(["22244112233"], stored).length, 1);
check("and it names whose it is", duplicatesAmong(["22244112233"], stored)[0].name, "مكتب النور");
check(
  "one duplicate among new numbers is still caught",
  duplicatesAmong(["22233221100", "22247778899"], stored).length,
  1
);
check("every clash is reported, not just the first", duplicatesAmong(["22244112233", "22247778899"], stored).length, 2);

// An office being edited must be allowed to keep its own numbers.
check("editing a row does not clash with itself", duplicatesAmong(["22244112233"], stored, "1").length, 0);
check("but still clashes with another row", duplicatesAmong(["22247778899"], stored, "1").length, 1);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
