/**
 * Checks how a provider error is read back to an admin. Runs offline: `npm run check:notifications`.
 *
 * The 24-hour window failure is the one that matters: it is not a bug to fix in code, it is WhatsApp
 * refusing free-form text to someone who has not written lately, and the only way out is an approved
 * template. If the log stops recognising it, that failure looks like a generic error again.
 */
import { explainSendError, isOutsideServiceWindow, notificationLabels } from "../src/lib/notifications";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

// Meta reports the code in the parenthesised form in some payloads and as JSON in others.
const outsideWindowParen = 'Meta WhatsApp send failed: (#131047) Message failed to send';
const outsideWindowJson = 'Meta WhatsApp send failed: {"error":{"code":131047,"message":"Re-engagement"}}';

check("parenthesised 131047 is the closed window", isOutsideServiceWindow(outsideWindowParen), true);
check("json 131047 is the closed window", isOutsideServiceWindow(outsideWindowJson), true);
check("a different code is not", isOutsideServiceWindow("(#131026) not on WhatsApp"), false);
check("null is not", isOutsideServiceWindow(null), false);
check("undefined is not", isOutsideServiceWindow(undefined), false);
check("empty is not", isOutsideServiceWindow(""), false);

// A code appearing inside unrelated digits must not be mistaken for the error itself.
check("a bare number in the text is not the code", isOutsideServiceWindow("sent 131047 messages"), false);

check(
  "the closed window is explained, not echoed",
  explainSendError(outsideWindowParen).includes("24 ساعة"),
  true
);

check(
  "the explanation names the fix",
  explainSendError(outsideWindowParen).includes("قالب"),
  true
);

check(
  "the original error is kept for debugging",
  explainSendError(outsideWindowParen).includes("131047"),
  true
);

check(
  "development mode is explained",
  explainSendError("(#131030) recipient not in allowed list").includes("وضع التطوير"),
  true
);

check(
  "an expired token is explained",
  explainSendError('{"code":190,"message":"expired"}').includes("META_WHATSAPP_TOKEN"),
  true
);

check(
  "an unrecognised error passes through unchanged",
  explainSendError("something nobody has seen before"),
  "something nobody has seen before"
);

// Every kind the code can log needs a label, or the page shows a raw slug to an admin.
check("every notification kind has an Arabic label", Object.values(notificationLabels).every(Boolean), true);
check("the label set is not empty", Object.keys(notificationLabels).length > 10, true);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
