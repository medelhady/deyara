/**
 * Checks the editable bot messages. Runs offline: `npm run check:messages`.
 *
 * These templates are edited from the dashboard and sent to real users, so the two rules that keep
 * an edit from breaking a conversation are worth pinning: an unknown variable must be refused at
 * save time, and an empty value must take its whole line with it rather than leaving a dangling
 * label like "السبب:".
 */
import {
  messageDefinitions,
  renderMessage,
  unknownVariables,
  variablesUsedIn
} from "../src/lib/bot-messages";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const pass = a === e;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : `\n      expected ${e}\n      got      ${a}`}`);
}

check("finds the variables in a line", variablesUsedIn("مرحبا {name} في {place}"), ["name", "place"]);
check("no braces means no variables", variablesUsedIn("مرحبا بك"), []);

// Saving is what must refuse a typo; sending later cannot recover from one.
check("a typo is reported", unknownVariables("referral_pitch", "اربح {welcomPoints} نقطة"), ["welcomPoints"]);
check("a declared variable is accepted", unknownVariables("referral_pitch", "{link} و {welcomePoints}"), []);
check("a message with no variables refuses any", unknownVariables("greeting", "أهلا {name}"), ["name"]);
check("plain text is always fine", unknownVariables("greeting", "أهلا وسهلا"), []);
check("an unknown message key reports nothing", unknownVariables("nope", "{x}"), []);

check(
  "a variable is substituted",
  renderMessage("رقم الإعلان: {code}", { code: "0007" }),
  "رقم الإعلان: 0007"
);

check(
  "an empty variable takes its line with it",
  renderMessage("رقم الإعلان: {code}\nالسبب: {reason}", { code: "0007", reason: "" }),
  "رقم الإعلان: 0007"
);

check(
  "an undefined variable takes its line with it",
  renderMessage("رقم الإعلان: {code}\nالسبب: {reason}", { code: "0007" }),
  "رقم الإعلان: 0007"
);

check(
  "a whitespace-only value counts as empty",
  renderMessage("السبب: {reason}", { reason: "   " }),
  ""
);

check(
  "a supplied reason keeps its line",
  renderMessage("رقم الإعلان: {code}\nالسبب: {reason}", { code: "0007", reason: "الفيديو غير واضح" }),
  "رقم الإعلان: 0007\nالسبب: الفيديو غير واضح"
);

// Blank lines are how an admin spaces a message out; they must survive rendering untouched.
check(
  "blank lines are preserved",
  renderMessage("أول\n\nثاني", {}),
  "أول\n\nثاني"
);

check(
  "a line keeps its place when only one of its variables is empty",
  renderMessage("{a} و {b}", { a: "س", b: "" }),
  "س و "
);

check("zero is a real value, not an empty one", renderMessage("لديك {n} نقطة", { n: 0 }), "لديك 0 نقطة");

// Every shipped default must itself be valid, or the fallback path sends a broken message.
for (const definition of messageDefinitions) {
  check(
    `the shipped "${definition.key}" uses only its own variables`,
    unknownVariables(definition.key, definition.fallback),
    []
  );

  check(`the shipped "${definition.key}" is not empty`, definition.fallback.trim().length > 0, true);
}

// The top-up instructions are sent for more than one reason, so the reason has to be the variable
// and not a sentence baked into the template. Prepending it once left the template's own sentence
// underneath: someone publishing a listing was quoted the listing price and then, right below, the
// price of an owner's number.
const topup = messageDefinitions.find((definition) => definition.key === "topup_instructions")!;

check(
  "the top-up template states no reason of its own",
  /عرض رقم المؤجر|نشر إعلان/.test(topup.fallback),
  false
);

check("the top-up template carries the reason as a variable", topup.fallback.includes("{purpose}"), true);

check(
  "a listing reason renders alone",
  renderMessage(topup.fallback, { purpose: "نشر إعلان يحتاج 3000 نقطة", paymentNumber: "44974444" })
    .includes("عرض رقم المؤجر"),
  false
);

// Reading order: what they wanted, what they have, then how to fix it.
const topupLines = topup.fallback.split("\n");
const purposeAt = topupLines.findIndex((line) => line.includes("{purpose}"));
const balanceAt = topupLines.findIndex((line) => line.includes("{balance}"));
const payAt = topupLines.findIndex((line) => line.includes("{paymentNumber}"));

check("the reason comes first", purposeAt === 0, true);
check("the balance follows the reason", balanceAt > purposeAt, true);
check("the payment number comes after both", payAt > balanceAt, true);

// An unknown balance must take its label with it, not leave "رصيدك الحالي:" hanging.
check(
  "an unknown balance drops its line",
  renderMessage(topup.fallback, { purpose: "سبب", paymentNumber: "44974444" }).includes("رصيدك الحالي"),
  false
);

check(
  "a zero balance still shows",
  renderMessage(topup.fallback, { purpose: "سبب", balance: 0, paymentNumber: "44974444" })
    .includes("رصيدك الحالي: *0 نقطة*"),
  true
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
