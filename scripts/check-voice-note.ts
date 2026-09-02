/**
 * Checks what happens when someone sends a voice note. Runs offline: `npm run check:voicenote`.
 *
 * WhatsApp delivers a voice note as an `audio` message with no text at all. Nothing parsed it, so it
 * arrived with an empty body and no media, fell through every branch, and landed on the generic
 * welcome -- someone spoke for a minute and was answered as though they had said nothing, with no
 * hint that they had not been heard. Voice notes are the normal way people write here.
 */
import { handleIncomingMessage } from "../src/lib/conversation/engine";
import { parseMetaWebhook } from "../src/lib/whatsapp/meta";
import { messageDefinitions } from "../src/lib/bot-messages";
import type { IncomingWhatsAppMessage } from "../src/lib/whatsapp/types";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

const spoken = messageDefinitions.find((item) => item.key === "voice_not_supported")!.fallback;

async function main() {
  const voice: IncomingWhatsAppMessage = {
    provider: "meta",
    from: "whatsapp:+22240000901",
    body: "",
    media: [{ url: "https://example.test/note.ogg", contentType: "audio/ogg; codecs=opus" }]
  };

  const answer = await handleIncomingMessage(voice);

  check("a voice note gets the spoken-message reply", answer.reply, spoken);
  check("and not the generic welcome", answer.reply.includes("يمكنك إرسال طلب مثل"), false);
  check("the reply says we cannot hear it", answer.reply.includes("لا نسمع"), true);

  // The branch must not swallow the two media kinds that do mean something.
  const photo: IncomingWhatsAppMessage = {
    provider: "meta",
    from: "whatsapp:+22240000902",
    body: "",
    media: [{ url: "https://example.test/r.jpg", contentType: "image/jpeg" }]
  };

  check("a photo is still read as a receipt", (await handleIncomingMessage(photo)).reply.includes("الإيصال"), true);

  const video: IncomingWhatsAppMessage = {
    provider: "meta",
    from: "whatsapp:+22240000903",
    body: "",
    media: [{ url: "https://example.test/v.mp4", contentType: "video/mp4" }]
  };

  check("a video is not mistaken for audio", (await handleIncomingMessage(video)).reply.includes("لا نسمع"), false);

  // The webhook has to surface the audio at all, which is where the whole thing was lost.
  const parsed = await parseMetaWebhook({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [{ id: "wamid.1", from: "22240000904", audio: { id: "media-1", mime_type: "audio/ogg", voice: true } }]
            }
          }
        ]
      }
    ]
  });

  check("the voice message is parsed at all", parsed.length, 1);
  check("with an empty body, as WhatsApp sends it", parsed[0].body, "");
  check("and no caption invented for it", parsed[0].body.length, 0);
}

void main().then(() => {
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
});
