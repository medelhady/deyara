/**
 * Checks when the bot stays out of a conversation a person has taken over. Runs offline:
 * `npm run check:handover`.
 *
 * Replying from the dashboard used to change nothing about the bot: it kept reading every message as
 * an answer to its own questions, so someone mid-sentence with a human was asked "في أي مقاطعة؟" or
 * told "طلبك مسجّل عندنا". The rules that stop that are all here -- when silence starts, when it
 * ends, and the single acknowledgement that keeps silence from reading as nobody being there.
 */
import {
  handoverExpiry,
  handoverMs,
  needsAcknowledgement,
  readHandover,
  startsNewHandover
} from "../src/lib/handover";
import { messageDefinitions } from "../src/lib/bot-messages";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

const now = Date.UTC(2026, 8, 7, 12, 0, 0);
const inFuture = (ms: number) => new Date(now + ms).toISOString();
const inPast = (ms: number) => new Date(now - ms).toISOString();

// Nobody has answered this number by hand, so the bot behaves exactly as it did before.
check("a number nobody took over is not handed over", readHandover(null, now).active, false);
check("nor is one with no deadline stored", readHandover({ human_until: null }, now).active, false);

// The ordinary case: an admin answered a few minutes ago.
const fresh = readHandover({ human_until: inFuture(handoverMs - 60_000), human_ack_at: null }, now);

check("a running handover silences the bot", fresh.active, true);
check("and its deadline is reported", Boolean(fresh.until), true);

// The whole point of the deadline: a handover forgotten overnight gives the bot back on its own.
check("a lapsed handover lets the bot answer again", readHandover({ human_until: inPast(60_000) }, now).active, false);
check("the boundary itself is over", readHandover({ human_until: new Date(now).toISOString() }, now).active, false);

// A stored value that is not a date must never silence a number forever.
check("a malformed deadline is ignored", readHandover({ human_until: "not a date" }, now).active, false);

// Twelve hours: long enough for an exchange that runs into the evening, short enough that a
// conversation left open is being answered again by morning.
check("the handover lasts twelve hours", handoverMs, 12 * 60 * 60 * 1000);
check("and a new one ends twelve hours from now", handoverExpiry(now), new Date(now + handoverMs).toISOString());

// Told once, not once per message: the explanation repeated after every line is the bot
// interrupting again in a politer voice.
check("the first message during a handover is acknowledged", needsAcknowledgement(fresh), true);
check(
  "the second is not",
  needsAcknowledgement(readHandover({ human_until: inFuture(1000), human_ack_at: inPast(1000) }, now)),
  false
);
check(
  "and a number with no handover is never acknowledged",
  needsAcknowledgement(readHandover(null, now)),
  false
);

// A reply that extends a running handover is the same conversation continuing; one sent after it
// lapsed is a new one, and its silence needs explaining again.
check("extending a live handover does not re-explain it", startsNewHandover(fresh), false);
check("but a handover starting from cold does", startsNewHandover(readHandover({ human_until: inPast(1) }, now)), true);
check("as does the first one ever", startsNewHandover(readHandover(null, now)), true);

// The acknowledgement is a message an admin can reword, like every other sentence the bot sends.
const ack = messageDefinitions.find((definition) => definition.key === "handover_ack");

check("the acknowledgement is editable from the dashboard", Boolean(ack), true);
check("and is never blank", Boolean(ack?.fallback.trim()), true);
check("it says a person has the message", Boolean(ack?.fallback.includes("موظف")), true);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
