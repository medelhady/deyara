/**
 * Checks that only Latin digits are read, and that none are ever shown. Runs offline: `npm run check:digits`.
 *
 * Mauritania writes 0-9. The Eastern forms ٠-٩ are not read here, so a message containing them is
 * not something a user typed on purpose -- and a bot reply containing them is one a user cannot
 * read at all. Accepting them was code guarding against a keyboard nobody uses, on paths where a
 * misread number is a wrong rent.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { extractMessage } from "../src/lib/conversation/extract";
import { parseRoomsAnswer } from "../src/lib/rooms-answer";
import { messageDefinitions } from "../src/lib/bot-messages";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

const eastern = /[\u0660-\u0669]/;

// Latin digits are read everywhere a number is asked for.
check("a rent in Latin digits is read", extractMessage("بحد أقصى 70000").maxPrice, 70000);
check("a room count in Latin digits is read", parseRoomsAnswer("3 غرف").rooms, 3);

// Eastern digits are not, on either path.
check("an Eastern rent is not read", extractMessage("بحد أقصى ٧٠٠٠٠").maxPrice, undefined);
check("an Eastern room count is not read", parseRoomsAnswer("٣ غرف").rooms, undefined);
check("but the sentence is still kept", parseRoomsAnswer("٣ غرف وجراج").extras, "٣ غرف وجراج");

/**
 * Nothing the bot says may contain them: a reader who cannot read the digits cannot check the rent
 * they are being quoted, and would have no way to know they had misread it.
 */
for (const definition of messageDefinitions) {
  check(`the message "${definition.key}" shows no Eastern digits`, eastern.test(definition.fallback), false);
}

/** Every string literal the engine sends, so a new message cannot reintroduce them unnoticed. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      return sources(path);
    }

    return path.endsWith(".ts") ? [path] : [];
  });
}

/**
 * Reading them is allowed; showing them is not.
 *
 * The rule is about what reaches the user. A pattern that turns ٣ into 3 before anything is read
 * takes a number from someone whose keyboard produced it and gives back an answer in the digits they
 * can check -- which serves the rule rather than breaking it. So a line whose Eastern digits sit
 * inside a character class is a reader and passes; the same digits in a sentence are text about to
 * be sent, and fail.
 */
const insideCharacterClass = /\[[^\]]*[\u0660-\u0669\u06f0-\u06f9][^\]]*\]/;

function sends(line: string) {
  const trimmed = line.trim();

  if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) {
    return false;
  }

  return eastern.test(line) && !insideCharacterClass.test(line);
}

const root = fileURLToPath(new URL("../src/lib/conversation", import.meta.url));
const offenders = sources(root).filter((path) => readFileSync(path, "utf8").split("\n").some(sends));

check("no conversation source shows an Eastern digit", offenders.join(", "), "");

// The rule it still enforces, stated where it can be seen: a sentence carrying them is refused.
check("a reply carrying them would be caught", sends('  return "السعر ٦٠٠٠٠";'), true);
check("while a reader of them is not", sends("  return value.replace(/[٠-٩]/g, toLatin);"), false);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
