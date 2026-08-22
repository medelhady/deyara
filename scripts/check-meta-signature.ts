/**
 * Checks the Meta webhook signature rules. Runs offline with no credentials: `npm run check:signature`.
 *
 * Worth keeping green — the admin WhatsApp commands trust the sender number on the parsed payload,
 * so if this verification ever silently stops rejecting forged bodies, anyone who knows the webhook
 * URL can approve listings and credit points.
 */
import crypto from "node:crypto";
import { verifyMetaSignature } from "../src/lib/whatsapp/meta";

const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: "22245678901" }] } }] }] });
const secret = "test-app-secret";

function sign(payload: string, key: string) {
  return "sha256=" + crypto.createHmac("sha256", key).update(payload, "utf8").digest("hex");
}

const cases: Array<[string, () => boolean, boolean]> = [
  ["valid signature accepted", () => verifyMetaSignature(body, sign(body, secret)), true],
  ["wrong secret rejected", () => verifyMetaSignature(body, sign(body, "other-secret")), false],
  ["tampered body rejected", () => verifyMetaSignature(body + " ", sign(body, secret)), false],
  ["missing header rejected", () => verifyMetaSignature(body, null), false],
  ["missing sha256= prefix rejected", () => verifyMetaSignature(body, "abcdef"), false],
  ["malformed hex rejected", () => verifyMetaSignature(body, "sha256=zzzz"), false],
  ["short hex rejected", () => verifyMetaSignature(body, "sha256=aa"), false]
];

process.env.META_APP_SECRET = secret;

let failures = 0;

for (const [name, run, expected] of cases) {
  let actual: boolean | string;

  try {
    actual = run();
  } catch (error) {
    actual = `THREW: ${error instanceof Error ? error.message : String(error)}`;
  }

  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

delete process.env.META_APP_SECRET;
const openWhenUnset = verifyMetaSignature(body, null);
const openPass = openWhenUnset === true;
if (!openPass) failures++;
console.log(`${openPass ? "PASS" : "FAIL"}  unset secret stays open (expected true, got ${openWhenUnset})`);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
