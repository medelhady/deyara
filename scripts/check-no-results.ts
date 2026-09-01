/**
 * Checks what the bot says when a search finds nothing. Runs offline: `npm run check:noresults`.
 *
 * A real conversation: someone asked for a house in تنسويلم, got "ما حصلت نتيجة مناسبة حاليًا", typed
 * "؟", and was answered "ما حصلت نتيجة مناسبة لـ ؟ حاليًا". Two failures in four lines -- the search
 * term was echoed back as a place name, and neither reply said where houses actually were. The
 * three no-result paths each named the same two districts, hardcoded when the code was written,
 * whether or not anything was listed in them.
 */
import { renderMessage, messageDefinitions } from "../src/lib/bot-messages";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

const template = messageDefinitions.find((definition) => definition.key === "no_results")!.fallback;
const available = ["المتوفر الآن:", "• لكصر — 12 دار", "• عرفات — 8 دور"].join("\n");

// The district was named and had nothing.
const named = renderMessage(template, { place: "تنسويلم", available });

check("it names what was searched for", named.includes("تنسويلم"), true);
check("it lists what is actually published", named.includes("• لكصر — 12 دار"), true);
check("it points at the wider district", named.includes("المقاطعة اللي فيها منطقتك"), true);
check("no hardcoded district survives the change", named.includes("كارفور"), false);
check("it opens on the place, not a blank line", named.startsWith("ما عندنا"), true);

// "؟" is not a place. The line naming it has to disappear rather than repeat the punctuation.
const noPlace = renderMessage(template, { place: "", available });

check("an unusable term is not echoed back", noPlace.includes("ما عندنا دور في"), false);
check("and leaves no blank first line", noPlace.startsWith("جرّب"), true);
check("the list is still offered", noPlace.includes("• لكصر — 12 دار"), true);

// Nothing published at all: promising a list and showing none is worse than not offering.
const empty = renderMessage(template, { place: "تنسويلم", available: "" });

check("no heading is left dangling", empty.includes("المتوفر الآن"), false);
check("the place is still named", empty.includes("تنسويلم"), true);
check("and no double gap is left behind", empty.includes("\n\n\n"), false);

const bothEmpty = renderMessage(template, { place: "", available: "" });

check("the barest case still says something", bothEmpty.length > 0, true);
check("and starts on a real line", bothEmpty.startsWith("جرّب"), true);
check("with no double gap either", bothEmpty.includes("\n\n\n"), false);

// The trimming must not eat spacing an admin typed between lines that survive.
check("single blank lines are kept", named.split("\n\n").length > 1, true);
check("and nothing trails at the end", named.endsWith("."), true);

// Through the real builder, which is where the search term is judged. "__more__" is the sentinel for
// "show me the rest" and would otherwise have been read back to the user as a district name.
async function throughEngine() {
  const { buildNoResults } = await import("../src/lib/conversation/engine");

  const sentinel = await buildNoResults("__more__");
  check("the __more__ sentinel never reaches the user", sentinel.includes("__more__"), false);

  const punctuation = await buildNoResults("؟");
  check("a lone question mark is not a place", punctuation.includes("ما عندنا دور في"), false);

  const real = await buildNoResults("تنسويلم");
  check("a real place name is kept", real.includes("تنسويلم"), true);

  const nothing = await buildNoResults(null);
  check("a missing term does not crash", nothing.length > 0, true);
}

void throughEngine().then(() => {
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
});
