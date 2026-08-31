/**
 * Checks that a greeting is answered in kind. Runs offline: `npm run check:greeting`.
 *
 * Every greeting used to open with "وعليكم السلام", so "صباح الخير" was answered with a reply to a
 * message the user had not sent. It read as GPT being down, which it was not: GPT decides that a
 * message is a greeting, and the wording of the answer is ours.
 */
import { salutationFor } from "../src/lib/conversation/greeting";
import { renderMessage, messageDefinitions } from "../src/lib/bot-messages";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

check("صباح الخير is answered with صباح النور", salutationFor("صباح الخير"), "صباح النور");
check("مساء الخير is answered with مساء النور", salutationFor("مساء الخير"), "مساء النور");
check("السلام عليكم still gets وعليكم السلام", salutationFor("السلام عليكم"), "وعليكم السلام");
check("the bare سلام too", salutationFor("سلام"), "وعليكم السلام");
check("مرحبا gets a welcome", salutationFor("مرحبا"), "أهلًا وسهلًا");

// Spelling the same word differently must not change the answer.
check("أهلا with hamza matches اهلا", salutationFor("أهلا"), "أهلًا وسهلًا");
check("صباح الخير with harakat matches", salutationFor("صَباح الخير"), "صباح النور");
check("trailing space does not break it", salutationFor("  صباح الخير  "), "صباح النور");

// The longer peace greeting must not be claimed by the bare one.
check(
  "السلام عليكم ورحمة الله is answered in kind",
  salutationFor("السلام عليكم ورحمة الله وبركاته"),
  "وعليكم السلام ورحمة الله وبركاته"
);

// A greeting GPT recognised but this list does not must still open with something.
check("an unlisted greeting still gets a salutation", salutationFor("يعطيك العافية"), "أهلًا بيك");
check("an empty body does not crash", salutationFor(""), "أهلًا بيك");

// The salutation has to reach the message, and the message must never render with a hole in it.
const greeting = messageDefinitions.find((definition) => definition.key === "greeting");

check("greeting declares the salutation variable", greeting?.variables.some((v) => v.name === "salutation"), true);

const rendered = renderMessage(greeting?.fallback ?? "", { salutation: salutationFor("صباح الخير") });

check("the reply opens with the matching salutation", rendered.startsWith("صباح النور"), true);
check("and no longer opens with وعليكم السلام", rendered.startsWith("وعليكم السلام"), false);
check("no literal placeholder survives", rendered.includes("{salutation}"), false);
check("the body is still there", rendered.includes("الديارة"), true);

// A caller that forgets the value would drop the whole line, leaving an empty reply.
check("the salutation is never optional", renderMessage(greeting?.fallback ?? "", {}).trim().length === 0, true);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
