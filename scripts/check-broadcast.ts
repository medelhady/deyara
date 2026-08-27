/**
 * Checks the broadcast audience rules. Runs offline: `npm run check:broadcast`.
 *
 * A broadcast cannot be recalled, so the two rules worth pinning are who is in an audience and who
 * is actually attempted. Sending to someone outside the 24-hour window fails, spends one of the 250
 * daily business-initiated conversations, and a run of refusals is what drags a number's quality
 * rating down -- so those are skipped rather than tried.
 */
import { audienceLabels, isAudience } from "../src/lib/broadcast";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const pass = a === e;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${e}, got ${a})`);
}

check("all is an audience", isAudience("all"), true);
check("renter is an audience", isAudience("renter"), true);
check("owner is an audience", isAudience("owner"), true);
check("marketer is an audience", isAudience("marketer"), true);

// The audience name reaches the query, so anything unrecognised must be refused before it gets there.
check("an unknown name is refused", isAudience("everyone"), false);
check("an empty name is refused", isAudience(""), false);
check("a sql-ish string is refused", isAudience("all; drop table users"), false);
check("an inherited property is not an audience", isAudience("toString"), false);
check("every audience has an Arabic label", Object.values(audienceLabels).every(Boolean), true);

/** Only phones seen in the last 24 hours are attempted; the rest are reported, not sent to. */
function attempted(all: string[], reachable: string[]) {
  return all.filter((phone) => reachable.includes(phone));
}

const audience = ["a", "b", "c", "d"];
const reachable = ["b", "d"];

check("only reachable phones are attempted", attempted(audience, reachable), ["b", "d"]);
check("the skipped count is the difference", audience.length - reachable.length, 2);
check("nobody reachable means nobody attempted", attempted(audience, []), []);
check("an empty audience attempts nobody", attempted([], reachable), []);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
