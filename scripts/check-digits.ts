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

const root = fileURLToPath(new URL("../src/lib/conversation", import.meta.url));
const offenders = sources(root).filter((path) => {
  return readFileSync(path, "utf8")
    .split("\n")
    .some((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//") && eastern.test(line));
});

check("no conversation source carries an Eastern digit", offenders.join(", "), "");

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
