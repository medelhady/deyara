/**
 * Checks how a house video reaches a renter. Runs offline: `npm run check:video`.
 *
 * A renter who asked to see the house was sent "22244974444/1788127687522.mp4" -- the storage path,
 * pasted into a text message. The bucket is private, so that string was never going to open, and
 * nothing in the code was watching the difference between a path and a link.
 *
 * Two things are pinned here: the video goes out as a video, and a video that cannot be sent still
 * reaches the renter as something they can open rather than as silence.
 */
process.env.META_WHATSAPP_TOKEN = "test-token";
process.env.META_PHONE_NUMBER_ID = "test-phone-id";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { metaWhatsAppProvider } from "../src/lib/whatsapp/meta";
import { sendVideoNotification } from "../src/lib/notifications";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

type Sent = { type: string; body: Record<string, any> };

const sent: Sent[] = [];
let refuseVideo = false;

/** Set to make the storage link look dead, the way an expired signature does. */
let breakLink = false;

/** Set to make Meta refuse the upload, so the link path is exercised instead. */
let refuseUpload = false;

const uploads: string[] = [];

globalThis.fetch = (async (url: string, init: any) => {
  const target = String(url);

  // Three different calls arrive here: the preflight and the file read (no body), the media upload
  // (a FormData body), and the send itself (JSON).
  if (target.includes("/media")) {
    uploads.push(target);

    return refuseUpload
      ? new Response('{"error":{"code":131053,"message":"Media upload error"}}', { status: 400 })
      : new Response('{"id":"media-123"}', { status: 200 });
  }

  if (!init?.body) {
    return breakLink
      ? new Response(null, { status: 403 })
      : new Response("videobytes", {
          status: 200,
          headers: { "content-type": "video/mp4", "content-length": "2000000" }
        });
  }

  const body = JSON.parse(init.body);
  sent.push({ type: body.type, body });

  if (refuseVideo && body.type === "video") {
    return new Response('{"error":{"code":131052,"message":"Media upload error"}}', { status: 400 });
  }

  return new Response("{}", { status: 200 });
}) as unknown as typeof fetch;

async function main() {
  const link = "https://project.supabase.co/storage/v1/object/sign/property-media/222/1.mp4?token=abc";

  // The happy path: the video alone, no caption for WhatsApp to wrap.
  await metaWhatsAppProvider.sendVideo("whatsapp:+22244974444", link);

  check("one message goes out", sent.length, 1);
  check("it is a video, not text", sent[0].type, "video");
  check("no caption rides on the video", sent[0].body.video.caption, undefined);
  check("the whatsapp: prefix is stripped", sent[0].body.to, "22244974444");

  // The file is uploaded and sent by id. Handing Meta a link means it fetches the URL after
  // answering us, so anything that goes wrong there is accepted and then silently dropped.
  check("the file is uploaded first", uploads.length, 1);
  check("and sent by its media id", sent[0].body.video.id, "media-123");
  check("no link is handed over when the upload worked", sent[0].body.video.link, undefined);

  // If Meta refuses the upload it says so, and that failure is worth falling back on rather than
  // giving up: the link path is the one thing left that might still work.
  sent.length = 0;
  uploads.length = 0;
  refuseUpload = true;

  await metaWhatsAppProvider.sendVideo("whatsapp:+22244974444", link);

  check("a refused upload falls back to the link", sent[0].body.video.link, link);
  check("and the link is a url, never a bare storage path", sent[0].body.video.link.startsWith("https://"), true);

  refuseUpload = false;
  sent.length = 0;
  uploads.length = 0;

  // Meta refusing the file -- too large, or unfetchable -- must not end in silence.
  sent.length = 0;
  refuseVideo = true;

  const fallback = await sendVideoNotification("whatsapp:+22244974444", link, "bot_reply");

  check("the renter still gets a message", fallback.ok, true);
  check("and is told it came as a link", fallback.viaLink, true);
  check("the video was attempted first", sent[0].type, "video");
  check("then text was sent", sent[1].type, "text");
  check("the text carries the link so it can still be watched", sent[1].body.text.body.includes(link), true);
  check("and says what the link is", sent[1].body.text.body.includes("فيديو الدار"), true);

  // A dead storage link must be caught before Meta sees it. Meta answers a link-based send before it
  // fetches the link, so handing one over succeeds and delivers nothing at all.
  sent.length = 0;
  refuseVideo = false;
  breakLink = true;

  const deadLink = await sendVideoNotification("whatsapp:+22244974444", link, "bot_reply");

  check("a dead link never reaches Meta as a video", sent.some((item) => item.type === "video"), false);
  check("the renter still gets something", deadLink.ok, true);
  check("and it is the link as text", sent[0]?.type, "text");
  check("carrying the url", sent[0]?.body.text.body.includes(link), true);

  breakLink = false;

  // Both failing is a real failure, and the caller has to be able to see it.
  sent.length = 0;
  globalThis.fetch = (async () => new Response('{"error":{"code":131026}}', { status: 400 })) as unknown as typeof fetch;

  const dead = await sendVideoNotification("whatsapp:+22244974444", link, "bot_reply");

  check("a total failure is reported as one", dead.ok, false);

  // The instruction that follows the video is a message of its own, and must not end on a lone Latin
  // numeral: that is the line that wrapped away from its own sentence in the caption.
  const engine = readFileSync(
    join(fileURLToPath(new URL("..", import.meta.url)), "src", "lib", "conversation", "engine.ts"),
    "utf8"
  );
  const instruction = engine.split("\n").find((line) => line.includes("هذا فيديو الدار")) ?? "";

  check("the video reply still exists to check", instruction.length > 0, true);
  check("it does not trail off on a bare digit", /: \d+"/.test(instruction), false);
  check("the digit is marked so it reads as a command", instruction.includes("*1*"), true);
}

void main().then(() => {
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
});
