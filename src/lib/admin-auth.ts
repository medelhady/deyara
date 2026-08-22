/**
 * Password hashing and dashboard session tokens.
 *
 * Everything here uses Web Crypto rather than node:crypto so the exact same code runs in the
 * middleware, which Next.js executes on the Edge runtime, and in the API routes, which run on Node.
 * A second implementation for the middleware would be a second place for the rules to drift.
 */

export const sessionCookieName = "deyara_admin";

const pbkdf2Iterations = 210_000;
const sessionTtlSeconds = 60 * 60 * 12;

export type AdminSession = {
  phone: string;
  name: string;
  exp: number;
};

/** Phone numbers arrive typed by hand, so compare them as digits only. */
export function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

/** Comparison that does not leak how much of the value matched through its running time. */
function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }

  return difference === 0;
}

/**
 * Web Crypto refuses a view backed by a SharedArrayBuffer, and a plain Uint8Array does not promise
 * it is not one. Copying into a fresh ArrayBuffer satisfies the type and the runtime alike.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  return buffer;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits"
  ]);

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: toArrayBuffer(salt), iterations, hash: "SHA-256" },
    key,
    256
  );

  return new Uint8Array(bits);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await deriveKey(password, salt, pbkdf2Iterations);

  return `pbkdf2$${pbkdf2Iterations}$${encodeBase64Url(salt)}$${encodeBase64Url(derived)}`;
}

export async function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$");

  if (parts.length !== 4 || parts[0] !== "pbkdf2") {
    return false;
  }

  const iterations = Number(parts[1]);

  if (!Number.isInteger(iterations) || iterations < 1000) {
    return false;
  }

  try {
    const salt = decodeBase64Url(parts[2]);
    const expected = decodeBase64Url(parts[3]);
    const derived = await deriveKey(password, salt, iterations);

    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Signing key for session cookies. Falls back to ADMIN_ACCESS_TOKEN so an existing deployment keeps
 * working without a new variable, but a dedicated secret is better: rotating the login key should
 * not have to mean rotating every signature.
 */
export function getSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET?.trim() || process.env.ADMIN_ACCESS_TOKEN?.trim() || "";
}

async function importSigningKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

export async function createSessionToken(phone: string, name: string) {
  const secret = getSessionSecret();

  if (!secret) {
    throw new Error("Cannot sign a session: ADMIN_SESSION_SECRET and ADMIN_ACCESS_TOKEN are both unset.");
  }

  const payload: AdminSession = {
    phone: normalizePhone(phone),
    name,
    exp: Math.floor(Date.now() / 1000) + sessionTtlSeconds
  };

  const body = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importSigningKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));

  return `${body}.${encodeBase64Url(signature)}`;
}

/** Returns the session when the signature is ours and the token has not expired, otherwise null. */
export async function verifySessionToken(token: string | undefined): Promise<AdminSession | null> {
  const secret = getSessionSecret();

  if (!token || !secret) {
    return null;
  }

  const [body, signature] = token.split(".");

  if (!body || !signature) {
    return null;
  }

  try {
    const key = await importSigningKey(secret);
    const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));

    if (!timingSafeEqual(expected, decodeBase64Url(signature))) {
      return null;
    }

    const session = JSON.parse(new TextDecoder().decode(decodeBase64Url(body))) as AdminSession;

    if (typeof session.exp !== "number" || session.exp * 1000 < Date.now()) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: sessionTtlSeconds
};
