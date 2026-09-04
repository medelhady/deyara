/**
 * Walks the marketer demo. Runs offline: `npm run check:demo`.
 *
 * The guarantee worth guarding is a negative one: nothing published here may reach the database. A
 * demo listing in the properties table would appear in real search results, and a renter would pay
 * real money for the number of a house that does not exist -- days before launch, that is trust you
 * cannot buy back.
 */
import { handleIncomingMessage } from "../src/lib/conversation/engine";
import { isDemoEntry, isDemoExit, hasDemoExpired, demoTimeoutMs, demoMark } from "../src/lib/conversation/demo";
import { getConversationState } from "../src/lib/conversation/store";
import type { IncomingWhatsAppMessage } from "../src/lib/whatsapp/types";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

// Spelling varies far more than intent, so the entry word is matched after normalisation.
for (const word of ["تجربة", "تجربه", "جرب", "اجرب", "تجريب", "التجربة"]) {
  check(`"${word}" opens the walkthrough`, isDemoEntry(word), true);
}

check("a landmark containing the word does not", isDemoEntry("قرب تجربة الطرق"), false);
check("nor does an ordinary search", isDemoEntry("لكصر"), false);

for (const word of ["خروج", "انهاء", "ايقاف"]) {
  check(`"${word}" closes it`, isDemoExit(word), true);
}

const now = Date.now();

check("a fresh walkthrough has not expired", hasDemoExpired({ startedAt: new Date(now).toISOString() }, now), false);
check(
  "one left open past the timeout has",
  hasDemoExpired({ startedAt: new Date(now - demoTimeoutMs - 1000).toISOString() }, now),
  true
);

const phone = "whatsapp:+22240009999";
const say = (body: string, media: IncomingWhatsAppMessage["media"] = []): IncomingWhatsAppMessage => ({
  provider: "simulator",
  from: phone,
  body,
  media
});

async function main() {
  const opened = await handleIncomingMessage(say("تجربة"));

  check("the opening reply is marked", opened.reply.startsWith(demoMark), true);
  check("and says nothing is real", opened.reply.includes("لا شيء هنا حقيقي"), true);

  for (const step of ["عندي منزل للإيجار", "لكصر", "70000", "قرب ملعب لكصر", "3 غرف وجراج", "12000"]) {
    const reply = await handleIncomingMessage(say(step));
    check(`the reply to "${step}" carries the mark`, reply.reply.startsWith(demoMark), true);
  }

  await handleIncomingMessage(say("", [{ url: "https://example.test/a.mp4", contentType: "video/mp4" }]));

  const published = await handleIncomingMessage(say("نعم"));

  check("publishing explains the real approval step", published.reply.includes("للإدارة أولًا"), true);
  check("and says it was skipped here", published.reply.includes("نشرناه فورًا"), true);

  /** The listing lives in the conversation and nowhere else. */
  const state = await getConversationState(phone);

  check("the listing is held in the conversation", Boolean(state.demo?.listing), true);
  check("with no draft left behind", state.draftProperty, undefined);
  check("and it is the one they described", state.demo?.listing?.area, "لكصر");
  check("carrying their commission", state.demo?.listing?.commission, 12000);
  check("and their extras", state.demo?.listing?.extras, "جراج");

  // Searching finds their own listing, and only theirs.
  const results = await handleIncomingMessage(say("لكصر"));

  check("searching finds the demo listing", results.reply.includes("70,000"), true);

  /**
   * The video step, which used to answer "الفيديو غير متوفر".
   *
   * The listing has no row, so looking it up by id found nothing -- and a walkthrough that tells a
   * marketer videos do not show teaches them to promise the opposite of the truth.
   */
  await handleIncomingMessage(say("1"));

  const watched = await handleIncomingMessage(say("2"));

  check("the video step never reads as a broken listing", watched.reply.includes("غير متوفر"), false);
  check("it explains what the renter sees here", watched.reply.includes("يشوف المستأجر فيديو"), true);
  check("and names why it matters to a marketer", watched.reply.includes("ما يدفع إلا بعد"), true);

  const revealed = await handleIncomingMessage(say("1"));

  check("the number shown is their own", revealed.reply.includes(phone.replace("whatsapp:+", "")), true);
  check("the closing message follows", (revealed.followUps ?? []).length, 1);
  check("asking whether they understood", (revealed.followUps ?? [])[0]?.includes("هل فهمت آلية العمل"), true);
  check("and inviting repetition", (revealed.followUps ?? [])[0]?.includes("كررها"), true);
  check("while saying nothing was charged", (revealed.followUps ?? [])[0]?.includes("ما خُصم شيء"), true);

  const left = await handleIncomingMessage(say("خروج"));

  check("leaving is confirmed", left.reply.includes("كل شيء الآن حقيقي"), true);
  check("and the reply is no longer marked", left.reply.startsWith(demoMark), false);

  const after = await getConversationState(phone);

  check("nothing of the walkthrough is left", after.demo, undefined);
  check("nor its search results", after.selectedProperty, undefined);
}

void main().then(() => {
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
});
