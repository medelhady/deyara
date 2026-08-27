/**
 * Checks when a notification falls back to an approved template.
 * Runs offline: `npm run check:template`.
 *
 * The rule this pins: a template is only for the one failure it can fix. Free-form text is tried
 * first because inside the 24-hour window it is free, carries the whole message rather than a fixed
 * one, and needs no approval. Falling back on any other failure would be wrong -- an expired token
 * or a number not on WhatsApp fails the template too, and retrying would just bill a second attempt
 * and log a misleading success.
 */
import { isOutsideServiceWindow } from "../src/lib/notifications";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

// Only this one means "the window closed", which is the only failure a template can rescue.
check(
  "closed window triggers the fallback",
  isOutsideServiceWindow("Meta WhatsApp send failed: (#131047) Re-engagement message"),
  true
);

check(
  "closed window in json form triggers it",
  isOutsideServiceWindow('{"error":{"code":131047,"message":"Re-engagement"}}'),
  true
);

check("an expired token does not", isOutsideServiceWindow('{"code":190,"message":"expired"}'), false);
check("a number not on WhatsApp does not", isOutsideServiceWindow("(#131026) not on WhatsApp"), false);
check("development mode does not", isOutsideServiceWindow("(#131030) not in allowed list"), false);
check("rate limiting does not", isOutsideServiceWindow("(#131056) too many messages"), false);
check("an unknown error does not", isOutsideServiceWindow("connection reset"), false);
check("no error at all does not", isOutsideServiceWindow(null), false);

/**
 * Meta refuses a template whose parameter is missing or empty, so a caller that cannot fill every
 * placeholder must pass no fallback rather than a half-filled one.
 */
function parametersAreSendable(parameters: string[]) {
  return parameters.length > 0 && parameters.every((value) => value.trim().length > 0);
}

check("a fully filled template is sendable", parametersAreSendable(["0007", "2000", "500"]), true);
check("an empty parameter is not", parametersAreSendable(["0007", "", "500"]), false);
check("a whitespace parameter is not", parametersAreSendable(["0007", "  ", "500"]), false);
check("no parameters at all is not", parametersAreSendable([]), false);

// Zero is a real value a listing message can legitimately carry.
check("a zero parameter is sendable", parametersAreSendable(["0007", "2000", "0"]), true);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
