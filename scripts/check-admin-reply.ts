/**
 * Checks when an admin reply can be sent, and how it is marked. Runs offline: `npm run check:adminreply`.
 *
 * The reply leaves from the bot's own number, so it has to say a person wrote it -- otherwise people
 * learn the bot understands more than it does and phrase their next question for a reader who is not
 * there. And WhatsApp refuses free-form text to anyone who has not written in the last 24 hours, so
 * the box has to know that before anything is typed rather than after the send fails.
 */
import { canReply, formatAdminReply, humanPrefix, replyWindowMs } from "../src/lib/admin-reply";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

const now = Date.UTC(2026, 8, 2, 12, 0, 0);
const ago = (ms: number) => new Date(now - ms).toISOString();

// Someone who just wrote is the ordinary case: they asked a question and are waiting.
const fresh = canReply(ago(5 * 60 * 1000), now);

check("a reply to someone who just wrote is allowed", fresh.open, true);
check("and they are known to have written", fresh.everWrote, true);
check("with the deadline reported", Boolean(fresh.openUntil), true);

// Just inside and just outside the window, which is where an off-by-one would hide.
check("an hour short of the limit is still open", canReply(ago(replyWindowMs - 60 * 60 * 1000), now).open, true);
check("a minute past it is closed", canReply(ago(replyWindowMs + 60 * 1000), now).open, false);

// A cold conversation and a number that never wrote need different sentences, so they are told apart.
const cold = canReply(ago(3 * replyWindowMs), now);

check("an old conversation is closed", cold.open, false);
check("but is known to have written before", cold.everWrote, true);

const never = canReply(null, now);

check("a number that never wrote is closed", never.open, false);
check("and is not mistaken for one that went cold", never.everWrote, false);
check("with no deadline invented", never.openUntil, null);

check("a malformed timestamp is refused, not thrown on", canReply("not a date", now).open, false);

// The mark that says a person wrote this.
const reply = formatAdminReply("رقم المؤجر صحيح، جرّب الاتصال بعد المغرب.");

check("the reply is marked as human", reply.startsWith(humanPrefix), true);
check("the mark names the business, not the bot", humanPrefix.includes("الديارة"), true);
check("the text follows on its own line", reply.includes("\n"), true);
check("and the message itself survives", reply.includes("جرّب الاتصال بعد المغرب"), true);

// Stray whitespace from a textarea must not become a blank line under the mark.
check("surrounding whitespace is trimmed", formatAdminReply("  مرحبا  \n"), `${humanPrefix}\nمرحبا`);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
