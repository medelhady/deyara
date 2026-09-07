/**
 * Walks the collection-mode intake. Runs offline: `npm run check:collection`.
 *
 * With no listings, the full flow -- a video, a fee, an approval wait, paying for a number -- is
 * friction that only makes sense once there is inventory, and it is how the first hundred users are
 * lost. While the switch is on the bot does one thing: three questions of each side, written down,
 * with the district as what joins them.
 */
process.env.COLLECTION_MODE = "on";

import { handleIncomingMessage } from "../src/lib/conversation/engine";
import { readSide, readPrice, readSpecs, nextCollectQuestion } from "../src/lib/conversation/collect";
import { summariseByArea, type CollectionEntry } from "../src/lib/collection-entries";
import { messageGroup } from "../src/lib/bot-messages";
import type { IncomingWhatsAppMessage } from "../src/lib/whatsapp/types";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected ${expected}, got ${actual})`);
}

// Which side of the market, from a number or from what people write instead.
check("1 is an owner", readSide("1"), "owner");
check("2 is a renter", readSide("2"), "renter");
check("so is a sentence", readSide("عندي دار للكراء"), "owner");
check("and the other way", readSide("أدور على دار"), "renter");
check("an unusable answer is neither", readSide("شنو هذا"), undefined);

/**
 * The wider vocabulary comes from the bot dictionary, not from a second list kept beside it.
 *
 * "ندور" was in that dictionary from the start and missing here, so "ندور استديو" -- the most
 * ordinary sentence a renter could type -- was answered with "ما فهمت قصدك".
 */
const vocabulary = {
  owner: ["عندي", "لدي", "نأجر"],
  renter: ["ندور", "نبغي", "ابحث", "للكراء"]
};

check("ندور استديو is a renter", readSide("ندور استديو", vocabulary), "renter");
check("and so is نبغي دار", readSide("نبغي دار في لكصر", vocabulary), "renter");

// An ownership word settles a sentence that carries both: "عندي دار للكراء" is an offer.
check("ownership wins over the rental word", readSide("عندي دار للكراء", vocabulary), "owner");

check("a price is read", readPrice("70000"), 70000);
check("with words around it", readPrice("الإيجار 70000 في الشهر"), 70000);
check("a rent written in words is read too", readPrice("70 الف"), 70000);

const specs = readSpecs("3 غرف وجراج، قرب ملعب لكصر");

check("the sentence is kept whole", specs.specs, "3 غرف وجراج، قرب ملعب لكصر");
check("and the room count read out of it", specs.rooms, 3);

// The question order, which is the whole conversation.
check("nothing known asks the side", nextCollectQuestion({}), "side");
check("then the district", nextCollectQuestion({ side: "owner" }), "area");
check("then the price", nextCollectQuestion({ side: "owner", area: "لكصر" }), "price");
check("then the specs", nextCollectQuestion({ side: "owner", area: "لكصر", price: 70000 }), "specs");
// The owner is asked one more thing; a renter has no commission to name.
check(
  "an owner is asked the commission last",
  nextCollectQuestion({ side: "owner", area: "لكصر", price: 70000, specs: "3 غرف" }),
  "commission"
);
check(
  "and a complete owner entry asks nothing",
  nextCollectQuestion({ side: "owner", area: "لكصر", price: 70000, specs: "3 غرف", commission: 0 }),
  null
);
check(
  "a renter is never asked for one",
  nextCollectQuestion({ side: "renter", area: "لكصر", price: 60000, specs: "3 غرف" }),
  null
);

// Zero is a real rent to nobody, but it must not read as unanswered either.
check("a price of zero still counts as answered", nextCollectQuestion({ side: "owner", area: "x", price: 0 }), "specs");

const say = (from: string, body: string, media: IncomingWhatsAppMessage["media"] = []): IncomingWhatsAppMessage => ({
  provider: "simulator",
  from,
  body,
  media
});

async function main() {
  const owner = "whatsapp:+22240007001";

  const opened = await handleIncomingMessage(say(owner, "سلام"));

  check("any first message opens the intake", opened.reply.includes("عندك دار للكراء"), true);
  check("and it says what is being collected", opened.reply.includes("نجمع الآن"), true);

  check("the district is asked next", (await handleIncomingMessage(say(owner, "1"))).reply.includes("أي مقاطعة"), true);
  check("then the rent", (await handleIncomingMessage(say(owner, "لكصر"))).reply.includes("كم إيجارها"), true);

  const asksSpecs = await handleIncomingMessage(say(owner, "70000"));

  check("then the specs", asksSpecs.reply.includes("كم غرفة"), true);
  check("inviting the landmark inside the example", asksSpecs.reply.includes("قرب ملعب لكصر"), true);

  const asksCommission = await handleIncomingMessage(say(owner, "3 غرف وجراج، قرب ملعب لكصر"));

  check("the owner is then asked the commission", asksCommission.reply.includes("عمولة المكتب"), true);
  check("and told the renter pays it", asksCommission.reply.includes("يدفعها المستأجر"), true);
  check("with zero offered", asksCommission.reply.includes("اكتب: 0"), true);

  const saved = await handleIncomingMessage(say(owner, "30 الف"));

  check("it is saved with no confirmation step", saved.reply.includes("سجّلنا دارك"), true);
  check("naming the district back", saved.reply.includes("لكصر"), true);
  check("and the rent as an amount", saved.reply.includes("70,000 أوقية"), true);
  check("with what they wrote", saved.reply.includes("جراج"), true);
  check("and the commission written in words", saved.reply.includes("عمولة 30,000"), true);
  check("and an invitation to add another", saved.reply.includes("دار ثانية"), true);

  // The renter's half, which is the same three questions asked the other way round.
  const renter = "whatsapp:+22240007002";

  await handleIncomingMessage(say(renter, "مرحبا"));
  await handleIncomingMessage(say(renter, "2"));

  check("the renter is asked where", (await handleIncomingMessage(say(renter, "تفرغ زينة"))).reply.includes("أقصى إيجار"), true);

  await handleIncomingMessage(say(renter, "60 الف"));

  const savedRenter = await handleIncomingMessage(say(renter, "3 غرف وقريبة من المدرسة"));

  check("the request is saved", savedRenter.reply.includes("سجّلنا طلبك"), true);
  check("with the budget marked as a ceiling", savedRenter.reply.includes("حتى 60,000"), true);

  /** None of the full flow may run: a fee or a video here would contradict what they were told. */
  const stray = "whatsapp:+22240007003";
  const video = await handleIncomingMessage(
    say(stray, "", [{ url: "https://example.test/a.mp4", contentType: "video/mp4" }])
  );

  check("a video is turned away, not taken as a listing", video.reply.includes("ما نحتاج فيديو"), true);
  check("and no listing summary is shown", video.reply.includes("راجع ملخص"), false);

  /**
   * Someone who has registered and keeps writing is not a stranger.
   *
   * They were being welcomed from the top a minute after their request was saved, which reads as the
   * bot having forgotten them -- and the next thing they type is far more often a clarification than
   * a second house.
   */
  const followUp = await handleIncomingMessage(say(renter, "وتعود قريبة من المدرسة"));

  check("a follow-up is not welcomed as a first hello", followUp.reply.includes("أهلًا بك في الديارة"), false);
  check("they are told their request is held", followUp.reply.includes("مسجّل عندنا"), true);
  check("and offered a second entry", followUp.reply.includes("طلبًا ثانيًا"), true);

  const second = await handleIncomingMessage(say(renter, "2"));

  check("choosing a side then starts a fresh entry", second.reply.includes("أي مقاطعة"), true);

  /** A greeting is answered as a greeting, whatever else the bot is in the middle of. */
  const greeted = await handleIncomingMessage(say("whatsapp:+22240007009", "السلام عليكم"));

  check("a greeting gets one back", greeted.reply.startsWith("وعليكم السلام"), true);
  check("before the two options", greeted.reply.includes("عندك دار للكراء"), true);

  const morning = await handleIncomingMessage(say("whatsapp:+22240007010", "صباح الخير"));

  check("and the right one back", morning.reply.startsWith("صباح النور"), true);

  /**
   * A greeting is understood. Being answered "وعليكم السلام، ما فهمت قصدك" tells someone in one
   * breath that they were understood and that they were not.
   */
  const greetedTwice = "whatsapp:+22240007012";

  await handleIncomingMessage(say(greetedTwice, "مرحبا"));

  const secondGreeting = await handleIncomingMessage(say(greetedTwice, "سلام"));

  check("a greeting is never met with ما فهمت قصدك", secondGreeting.reply.includes("ما فهمت قصدك"), false);
  check("it gets a salutation instead", secondGreeting.reply.startsWith("وعليكم السلام"), true);

  const stillUnclear = await handleIncomingMessage(say(greetedTwice, "شنو هذا الشي"));

  check("but real confusion still says so", stillUnclear.reply.includes("ما فهمت قصدك"), true);

  const plain = await handleIncomingMessage(say("whatsapp:+22240007011", "شنو هذا"));

  check("a non-greeting gets no salutation bolted on", plain.reply.startsWith("أهلًا بك في الديارة"), true);

  const searching = await handleIncomingMessage(say("whatsapp:+22240007004", "أريد دار في عرفات"));

  check("a search does not run the old flow", searching.reply.includes("المتوفر الآن"), false);
  check("it is read as a renter instead", searching.reply.includes("أي مقاطعة") || searching.reply.includes("عندك دار"), true);
}

// The counts that are the reason for collecting at all.
const entries: CollectionEntry[] = [
  { id: "1", phone: "a", side: "renter", area: "لكصر", price: 60000, specs: null, rooms: null, commission: null, addedByAdmin: false, createdAt: "" },
  { id: "2", phone: "b", side: "renter", area: "لكصر", price: 50000, specs: null, rooms: null, commission: null, addedByAdmin: false, createdAt: "" },
  { id: "3", phone: "c", side: "owner", area: "لكصر", price: 70000, specs: null, rooms: null, commission: null, addedByAdmin: false, createdAt: "" },
  { id: "4", phone: "d", side: "renter", area: "عرفات", price: 40000, specs: null, rooms: null, commission: null, addedByAdmin: true, createdAt: "" }
];

/**
 * Summarised against the known districts, as the page calls it.
 *
 * The intake stores the answer as written, so people who reply to "في أي مقاطعة" with a whole
 * sentence each became their own row -- a summary with one line per person counts nothing.
 */
const known = ["لكصر", "عرفات", "تفرغ زينة"];
const summary = summariseByArea(entries, known);

check("the busiest district comes first", summary[0].area, "لكصر");
check("with both sides counted", `${summary[0].owners}/${summary[0].renters}`, "1/2");
check("and quieter ones after", summary[1].area, "عرفات");

// A sentence is matched on the district inside it rather than becoming a row of its own.
const sentence = summariseByArea(
  [{ id: "5", phone: "e", side: "renter", area: "ابحث عن دار في عرفات قريبة من السوق", price: null, specs: null, rooms: null, commission: null, addedByAdmin: false, createdAt: "" }],
  known
);

check("a sentence is filed under its district", sentence[0].area, "عرفات");

const unknown = summariseByArea(
  [{ id: "6", phone: "f", side: "renter", area: "منطقة لا نغطيها", price: null, specs: null, rooms: null, commission: null, addedByAdmin: false, createdAt: "" }],
  known
);

// Not dropped: a request in a district nobody covers is the most useful line on the sheet.
check("an unmatched district is gathered, not lost", unknown[0].area, "مناطق أخرى");
check("and still counted", unknown[0].renters, 1);

// The messages page splits on this, so what is live is not buried under what is not.
check("collection messages are grouped apart", messageGroup("collect_start"), "collection");
check("and the rest are not", messageGroup("greeting"), "full");

void main().then(() => {
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
});
