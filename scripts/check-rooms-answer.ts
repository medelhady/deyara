/**
 * Checks the room count and the extras read out of one answer. Runs offline: `npm run check:rooms`.
 *
 * Asking only for a number threw away what owners actually say. "3 غرف وجراج السيارات وجلسة" is one
 * thought: the count, and the two things that make this house worth more than the next one at the
 * same price. Insisting on the bare number either loses the extras or teaches the owner to fight the
 * form, and neither leaves a renter a house they can picture.
 */
import { parseRoomsAnswer } from "../src/lib/rooms-answer";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

// The plain answer still works, and picks up no phantom description.
const bare = parseRoomsAnswer("3");

check("a bare number is the room count", bare.rooms, 3);
check("and carries no extras", bare.extras, undefined);

// The answer this was built for.
const full = parseRoomsAnswer("3 غرف وجراج السيارات وجلسة");

check("the count is read from a sentence", full.rooms, 3);
check("the rest becomes the extras", full.extras, "جراج السيارات وجلسة");
check("the word غرف is not repeated in them", full.extras?.includes("غرف"), false);
check("nor the joining و", full.extras?.startsWith("و"), false);

// Arabic-Indic digits are what many keyboards produce.
const arabic = parseRoomsAnswer("٤ غرف مع مطبخ كبير");

check("arabic digits are read", arabic.rooms, 4);
check("with their extras kept", arabic.extras, "مع مطبخ كبير");

check("no space before غرف is fine", parseRoomsAnswer("3غرف").rooms, 3);
check("and leaves nothing behind", parseRoomsAnswer("3غرف").extras, undefined);

// Commas instead of و.
const commas = parseRoomsAnswer("5 غرف، جراج، جلسة");

check("a comma list keeps its items", commas.extras, "جراج، جلسة");
check("with the count still read", commas.rooms, 5);

// Written out rather than typed: the count is left unanswered so it is asked again, and GPT gets its
// chance, rather than a number being invented here.
const words = parseRoomsAnswer("غرفتين وحوش");

check("a written count is not guessed at", words.rooms, undefined);
check("but the sentence is not thrown away", words.extras, "غرفتين وحوش");

check("an empty answer yields nothing", Object.keys(parseRoomsAnswer("   ")).length, 0);
check("and does not throw", parseRoomsAnswer("").rooms, undefined);

// A two-digit count is a real house; three digits is a typo, and only the first two are taken.
check("a two-digit count is read", parseRoomsAnswer("12 غرفة").rooms, 12);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
