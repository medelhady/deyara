/**
 * Checks how a video link is judged before it is handed to WhatsApp. Runs offline: `npm run check:videohealth`.
 *
 * A renter asked to see a house and nothing arrived. Meta answers a link-based send before it fetches
 * the link, so a dead URL is accepted with a 200 and then dropped in silence -- no error, no log, and
 * the renter has no way to tell a broken listing from a slow one. The listing in question had stored
 * the WhatsApp URL itself, which expires within minutes, because copying it to storage had failed and
 * the code fell back to it.
 */
import { checkVideoUrl, maxVideoBytes } from "../src/lib/video-health";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

const realFetch = globalThis.fetch;

function answer(status: number, headers: Record<string, string> = {}) {
  globalThis.fetch = (async () => new Response(null, { status, headers })) as unknown as typeof fetch;
}

async function main() {
  // A storage path that was never signed is the shape of the original bug.
  const unsigned = await checkVideoUrl("22244974444/1788127687522.mp4");

  check("a bare storage path is refused", unsigned.ok, false);
  check("and says why", unsigned.ok === false && unsigned.reason.includes("مسار تخزين"), true);

  // The expired WhatsApp link: storage answers 403 once the signature is stale.
  answer(403);
  const expired = await checkVideoUrl("https://example.test/a.mp4");

  check("an expired signature is caught", expired.ok, false);
  check("and named as expiry, not a generic failure", expired.ok === false && expired.reason.includes("منتهي"), true);

  answer(404);
  const gone = await checkVideoUrl("https://example.test/a.mp4");

  check("a deleted file is caught", gone.ok, false);
  check("and named as missing", gone.ok === false && gone.reason.includes("غير موجود"), true);

  // Past WhatsApp's limit, which it also drops silently.
  answer(200, { "content-type": "video/mp4", "content-length": String(maxVideoBytes + 1) });
  const huge = await checkVideoUrl("https://example.test/a.mp4");

  check("an oversized video is refused", huge.ok, false);
  check("with the size named", huge.ok === false && huge.reason.includes("ميجابايت"), true);

  // Something that is not a video at all.
  answer(200, { "content-type": "text/html", "content-length": "1000" });
  const notVideo = await checkVideoUrl("https://example.test/a.mp4");

  check("a non-video is refused", notVideo.ok, false);

  // The healthy case.
  answer(200, { "content-type": "video/mp4", "content-length": "2000000" });
  const good = await checkVideoUrl("https://example.test/a.mp4");

  check("a real video passes", good.ok, true);
  check("and its size is reported", good.ok === true && good.bytes, 2000000);

  // Exactly at the limit is still allowed: the cap is a maximum, not a threshold to fall under.
  answer(200, { "content-type": "video/mp4", "content-length": String(maxVideoBytes) });
  check("exactly 16MB is allowed", (await checkVideoUrl("https://example.test/a.mp4")).ok, true);

  // Storage that refuses HEAD but serves GET must not be called broken.
  let calls = 0;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    calls += 1;
    return init?.method === "HEAD"
      ? new Response(null, { status: 405 })
      : new Response(null, { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-0/3000000" } });
  }) as unknown as typeof fetch;

  const headRefused = await checkVideoUrl("https://example.test/a.mp4");

  check("a HEAD-refusing host is retried with GET", calls, 2);
  check("and the file is accepted", headRefused.ok, true);
  check("with the size read from content-range", headRefused.ok === true && headRefused.bytes, 3000000);

  // A hang must not hold the conversation open forever.
  globalThis.fetch = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
    })) as unknown as typeof fetch;

  const timedOut = await checkVideoUrl("https://example.test/a.mp4", 50);

  check("a hanging host times out", timedOut.ok, false);
  check("rather than throwing", timedOut.ok === false && timedOut.reason.length > 0, true);

  globalThis.fetch = realFetch;
}

void main().then(() => {
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
});
