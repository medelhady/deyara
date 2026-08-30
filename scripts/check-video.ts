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

globalThis.fetch = (async (_url: string, init: any) => {
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
  check("the link is the signed url", sent[0].body.video.link, link);
  check("no caption rides on the video", sent[0].body.video.caption, undefined);
  check("the whatsapp: prefix is stripped", sent[0].body.to, "22244974444");

  // A path instead of a link is exactly the bug, and it must never be what goes out.
  check("nothing bare-path shaped is sent", sent[0].body.video.link.startsWith("https://"), true);

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
