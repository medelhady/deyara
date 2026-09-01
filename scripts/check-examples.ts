/**
 * Checks that the examples the bot gives come from the database. Runs offline: `npm run check:examples`.
 *
 * The bot was telling people to try "أقل من 2500" while the cheapest house on the books was 45,000,
 * and to search "عرفات" whether or not anything was listed there. An example that cannot match
 * anything is worse than no example: it sends a first-time searcher into an empty result and teaches
 * them the wrong shape of number. These were written once, years of listings ago, and never revisited
 * because nothing failed when they went stale.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { renderMessage, messageDefinitions } from "../src/lib/bot-messages";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

const engine = readFileSync(
  join(fileURLToPath(new URL("..", import.meta.url)), "src", "lib", "conversation", "engine.ts"),
  "utf8"
);

/** Lines of bot text, ignoring comments and the fallback list of known districts. */
const botText = engine
  .split("\n")
  .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
  .filter((line) => !line.includes("const knownAreas"))
  .join("\n");

// The prices that were being quoted. A house costs tens of thousands; these read as a typo.
for (const stale of ["2500", "2450", "3000"]) {
  check(`no listing price example is hardcoded as ${stale}`, botText.includes(`أقصى ${stale}`) || botText.includes(`السعر ${stale}`) || botText.includes(`*${stale}*`), false);
}

check("the live example helper exists", engine.includes("export async function getSearchExample"), true);
check("and the refine menu uses it", engine.includes("example.maxPrice"), true);
check("as does the district example", engine.includes("example.area"), true);

// The message moved to the dashboard has to keep working, with nothing left unfilled.
const definition = messageDefinitions.find((item) => item.key === "refine_without_search");

check("the message is editable from the dashboard", Boolean(definition), true);
check("it declares the district", definition?.variables.some((variable) => variable.name === "area"), true);
check("and the price", definition?.variables.some((variable) => variable.name === "price"), true);

const rendered = renderMessage(definition?.fallback ?? "", { area: "لكصر", price: 60000 });

check("the district is filled in", rendered.includes("لكصر"), true);
check("and the price", rendered.includes("60000"), true);
check("no placeholder survives", rendered.includes("{"), false);
check("and no stale number is left in the wording", rendered.includes("2500"), false);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
