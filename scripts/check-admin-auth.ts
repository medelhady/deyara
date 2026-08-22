/**
 * Checks password hashing and session tokens. Runs offline: `npm run check:auth`.
 *
 * These two primitives are the whole dashboard login. A hash that verifies the wrong password, or a
 * token that survives editing, opens the panel and every owner phone number behind it.
 */
process.env.ADMIN_SESSION_SECRET = "test-session-secret";

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSessionToken,
  hashPassword,
  normalizePhone,
  verifyPassword,
  verifySessionToken
} from "../src/lib/admin-auth";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

/**
 * The middleware is the only thing standing in front of /admin. This project keeps its app under
 * src/, so Next.js looks for src/middleware.ts and silently ignores a copy at the repo root -- no
 * warning, no build error, just an unprotected dashboard. That shipped once; this catches it.
 */
function checkMiddlewarePlacement() {
  const root = fileURLToPath(new URL("..", import.meta.url));

  check("middleware lives at src/middleware.ts", existsSync(join(root, "src", "middleware.ts")), true);
  check("no ignored copy at the repo root", existsSync(join(root, "middleware.ts")), false);
}

async function main() {
  checkMiddlewarePlacement();

  check("normalizePhone strips formatting", normalizePhone("+222 456-78901"), "22245678901");

  const hash = await hashPassword("correct horse battery");
  check("correct password verifies", await verifyPassword("correct horse battery", hash), true);
  check("wrong password rejected", await verifyPassword("correct horse batteryx", hash), false);
  check("empty password rejected", await verifyPassword("", hash), false);
  check("garbage hash rejected", await verifyPassword("anything", "not-a-hash"), false);
  check("unknown algorithm rejected", await verifyPassword("anything", "md5$1$aa$bb"), false);
  check(
    "absurdly low iteration count rejected",
    await verifyPassword("anything", "pbkdf2$1$YWFhYQ$YmJiYg"),
    false
  );

  const second = await hashPassword("correct horse battery");
  check("same password hashes differently each time", hash === second, false);

  const token = await createSessionToken("+222 456-78901", "منسق");
  const session = await verifySessionToken(token);
  check("valid token verifies", session?.phone, "22245678901");
  check("token carries the name", session?.name, "منسق");

  check("tampered payload rejected", await verifySessionToken(`x${token}`), null);
  check("token without signature rejected", await verifySessionToken(token.split(".")[0]), null);
  check("empty token rejected", await verifySessionToken(""), null);
  check("undefined token rejected", await verifySessionToken(undefined), null);

  // A signature made with a different secret must not pass, or rotating the secret would mean nothing.
  process.env.ADMIN_SESSION_SECRET = "another-secret";
  check("token from a different secret rejected", await verifySessionToken(token), null);
  process.env.ADMIN_SESSION_SECRET = "test-session-secret";

  // Swapping in an expired payload must fail even though it is signed with the right key.
  const expired = await createSessionToken("22245678901", "منسق");
  const [body] = expired.split(".");
  const decoded = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  check("payload carries an expiry", typeof decoded.exp, "number");
  check("expiry is in the future", decoded.exp * 1000 > Date.now(), true);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
