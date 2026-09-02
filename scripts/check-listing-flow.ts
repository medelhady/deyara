/**
 * Walks a whole listing conversation. Runs offline: `npm run check:listingflow`.
 *
 * Asking for the room count put a bare number in the middle of a flow that already reads bare
 * numbers two other ways -- as a price, and as picking the nth result of an earlier search. This
 * drives the real engine end to end so those three readings stay separated, and so the count
 * actually reaches the summary the owner confirms.
 */
import { handleIncomingMessage } from "../src/lib/conversation/engine";
import type { IncomingWhatsAppMessage } from "../src/lib/whatsapp/types";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

const owner = "whatsapp:+22240000001";

function say(body: string, media: IncomingWhatsAppMessage["media"] = []): IncomingWhatsAppMessage {
  return { provider: "simulator", from: owner, body, media };
}

async function main() {
  const asksArea = await handleIncomingMessage(say("عندي منزل للايجار"));
  check("it starts by asking the district", asksArea.reply.includes("مقاطعة"), true);

  const asksPrice = await handleIncomingMessage(say("لكصر"));
  check("then the rent", asksPrice.reply.includes("سعر"), true);

  const asksLandmark = await handleIncomingMessage(say("45000"));
  check("then the landmark", asksLandmark.reply.includes("معلم"), true);

  // The new step.
  const asksRooms = await handleIncomingMessage(say("قرب السوق"));
  check("then the room count", asksRooms.reply.includes("عدد الغرف"), true);
  check("and it asks for a bare number", asksRooms.reply.includes("3"), true);

  const asksCommission = await handleIncomingMessage(say("3"));

  check("then the office commission", asksCommission.reply.includes("عمولة المكتب"), true);
  check("and zero is offered as an answer", asksCommission.reply.includes("اكتب: 0"), true);

  const asksVideo = await handleIncomingMessage(say("12000"));
  check("the video is asked for last", asksVideo.reply.includes("فيديو"), true);
  // A number burned into the video routes renters around the paywall, so the ask has to say so
  // every time it is repeated -- not once in a welcome message nobody rereads.
  check("and warns against a number in it", asksVideo.reply.includes("ولا تضع رقمك داخل الفيديو"), true);
  check("saying why it is in the owner's interest", asksVideo.reply.includes("الجاد وحده"), true);
  check("on its own line, not run together", asksVideo.reply.split("\n").length, 3);
  check("answering rooms does not re-ask them", asksVideo.reply.includes("عدد الغرف"), false);

  const summary = await handleIncomingMessage(
    say("", [{ url: "https://example.test/house.mp4", contentType: "video/mp4" }])
  );

  check("the video completes the draft", summary.reply.includes("راجع ملخص الإعلان"), true);
  check("the summary carries the room count", summary.reply.includes("عدد الغرف: 3"), true);
  check("and the commission the owner set", summary.reply.includes("12,000"), true);

  // The regression the room question invited: "3" must not have overwritten the rent.
  check("the price survived the room answer", summary.reply.includes("45000"), true);
  check("and was not replaced by the room count", summary.reply.includes("السعر: 3\n"), false);

  check("the district survived too", summary.reply.includes("لكصر"), true);
  check("so did the landmark", summary.reply.includes("قرب السوق"), true);

  // A draft cannot be confirmed before the count is in: without this the question is skippable.
  const other = "whatsapp:+22240000002";
  const short: IncomingWhatsAppMessage = { provider: "simulator", from: other, body: "", media: [] };

  await handleIncomingMessage({ ...short, body: "عندي شقة للايجار" });
  await handleIncomingMessage({ ...short, body: "عرفات" });
  await handleIncomingMessage({ ...short, body: "30000" });
  await handleIncomingMessage({ ...short, body: "قرب المستشفى" });
  await handleIncomingMessage({ ...short, body: "2" });

  const videoBeforeRooms = await handleIncomingMessage({
    ...short,
    media: [{ url: "https://example.test/flat.mp4", contentType: "video/mp4" }]
  });

  check("a video sent early does not skip the questions", videoBeforeRooms.reply.includes("عمولة المكتب"), true);
  check("and no summary is shown yet", videoBeforeRooms.reply.includes("راجع ملخص الإعلان"), false);

  // Zero is a complete answer -- "no commission on this house" -- and must not read as unanswered.
  const nowSummary = await handleIncomingMessage({ ...short, body: "0" });

  check("giving the count then finishes the draft", nowSummary.reply.includes("راجع ملخص الإعلان"), true);
  check("with the count in it", nowSummary.reply.includes("عدد الغرف: 2"), true);
  check("a zero commission finishes the draft rather than repeating", nowSummary.reply.includes("لا توجد"), true);
  check("and the rent intact", nowSummary.reply.includes("30000"), true);
}

void main().then(() => {
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
});
