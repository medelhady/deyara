/**
 * Checks the words a user can type to reach a feature. Runs offline: `npm run check:usercommands`.
 *
 * Renaming the balance from نقطة to أوقية rewrote these patterns along with the display text, and
 * "نقاطي" silently stopped working -- a user who learned that word has no way of finding out. Both
 * wordings are accepted now, and this pins that.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const engine = readFileSync(
  join(fileURLToPath(new URL("..", import.meta.url)), "src", "lib", "conversation", "engine.ts"),
  "utf8"
);

/** Pulls the alternatives out of an anchored alternation containing the given word. */
function patternContaining(word: string) {
  const line = engine.split("\n").find((candidate) => candidate.includes(`|${word}|`) || candidate.includes(`(${word}|`));

  return line ?? "";
}

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

const balance = patternContaining("رصيدي");

check("the balance command exists", balance.length > 0, true);
check("رصيدي still works", balance.includes("رصيدي"), true);
check("the old نقاطي still works", balance.includes("نقاطي"), true);
check("the new أوقيتي works", balance.includes("أوقيتي"), true);
// The replacement produced this, which is not a word.
check("the broken أوقيةي is gone", balance.includes("أوقيةي"), false);

const withdraw = patternContaining("طلب سحب");

check("the withdrawal command exists", withdraw.length > 0, true);
check("the old سحب نقاط still works", withdraw.includes("سحب نقاط"), true);
check("the new سحب أوقية works", withdraw.includes("سحب أوقية"), true);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
