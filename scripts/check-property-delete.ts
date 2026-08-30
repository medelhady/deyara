/**
 * Checks which listings a bulk delete is allowed to remove. Runs offline: `npm run check:propertydelete`.
 *
 * Selecting a whole district at once made one mistake much more expensive than it was: a listing a
 * renter paid to contact carries the record of that payment, and deleting it destroys the record.
 * Ticking fifty boxes must not do what ticking one at a time would have refused.
 */
import { planPropertyDeletion } from "../src/lib/property-delete";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

const listings = [
  { id: "a", property_code: "D-001" },
  { id: "b", property_code: "D-002" },
  { id: "c", property_code: null }
];

// A whole district selected, where one listing was paid for and one vanished meanwhile.
const plan = planPropertyDeletion(["a", "b", "c", "gone"], listings, ["b", "b"]);

check("the untouched listing is deletable", plan.deletable.includes("a"), true);
check("the one a renter paid for is not", plan.deletable.includes("b"), false);
check("a listing without a code is still deletable", plan.deletable.includes("c"), true);
check("an id that is no longer there is not deletable", plan.deletable.includes("gone"), false);

check("every selected id gets exactly one line", plan.deletable.length + plan.refused.length, 4);

const paid = plan.refused.find((item) => item.id === "b");
check("the paid listing is named by its code", paid?.code, "D-002");
check("the refusal counts the renters", paid?.reason?.startsWith("2 مستأجر"), true);
check("the refusal suggests hiding instead", paid?.reason?.includes("أخفِه"), true);

const missing = plan.refused.find((item) => item.id === "gone");
check("a missing listing falls back to a short id", missing?.code, "gone");
check("nothing is reported as deleted before it is", plan.refused.every((item) => !item.deleted), true);

// The same listing ticked twice must not be reported twice.
const twice = planPropertyDeletion(["a", "a"], listings, []);
check("a duplicated id is collapsed", twice.deletable.length, 1);

// Nothing paid for at all: the common case when clearing a test database.
const clean = planPropertyDeletion(["a", "c"], listings, []);
check("a clean selection deletes in full", clean.deletable.length, 2);
check("a clean selection refuses nothing", clean.refused.length, 0);

// Contact requests naming some other listing must not block this one.
const elsewhere = planPropertyDeletion(["a"], listings, ["b", "c"]);
check("requests on other listings do not block", elsewhere.deletable.includes("a"), true);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
