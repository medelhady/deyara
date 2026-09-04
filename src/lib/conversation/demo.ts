import type { DraftProperty, PropertyCandidate } from "./types";

/**
 * A walkthrough for someone who has to explain this bot to other people.
 *
 * A marketer who has never published a listing cannot describe publishing one, and a description
 * built from imagination is where wrong promises come from -- "it goes live straight away", "the
 * renter sees your number". So they walk both halves themselves: publish as an owner, then search as
 * a renter and find what they just published.
 *
 * Nothing is written to the database. Not as a precaution but as the design: a demo listing that
 * reached the properties table would appear in real search results, and a renter would pay real
 * money for the number of a house that does not exist. A filter excluding them can be forgotten at
 * any of a dozen query sites; a row that was never inserted cannot be.
 *
 * The same reason makes the search show only their own listing. Returning real ones alongside would
 * mean a free reveal of a real owner's number, and would blur whose listing they are looking at --
 * which is the one thing this is meant to teach.
 */

/** Long enough to walk both halves unhurried, short enough that nobody is stuck in it. */
export const demoTimeoutMs = 30 * 60 * 1000;

/** Prefixed to every reply, so no step is ever mistaken for the real thing. */
export const demoMark = "🧪 تجربة —";

export type DemoState = {
  startedAt: string;
  /**
   * Where the marketer's own video was stored.
   *
   * The file is uploaded like any other -- the walkthrough shows them their own house, and a step
   * that says "الفيديو غير متوفر" teaches exactly the wrong thing. It is deleted when the
   * walkthrough closes, so no file is left behind that nothing points at.
   */
  videoPath?: string;
  /** The listing they published here. Held in the conversation, never in the database. */
  listing?: PropertyCandidate;
  /** Set once the closing message has been sent, so it is not repeated on every message after. */
  finished?: boolean;
};

const entryWords = ["تجربة", "تجربه", "جرب", "اجرب", "تجريب", "التجربة", "التجربه", "جربني"];
const exitWords = ["خروج", "انهاء", "انهاء التجربة", "ايقاف", "توقف", "خروج من التجربة", "الغاء التجربة"];

/** Same normalisation the district matcher uses: spelling varies far more than intent does. */
function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/[ة]/g, "ه")
    .replace(/[ى]/g, "ي")
    .replace(/[ـًٌٍَُِّْ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ");
}

function matchesAny(body: string, words: string[]) {
  const text = normalize(body);

  // The whole message, not a word inside it: "قرب تجربة" as a landmark would otherwise restart the
  // walkthrough in the middle of a real listing.
  return words.some((word) => text === normalize(word));
}

export function isDemoEntry(body: string) {
  return matchesAny(body, entryWords);
}

export function isDemoExit(body: string) {
  return matchesAny(body, exitWords);
}

/** True once the walkthrough has been open long enough that its owner has probably forgotten it. */
export function hasDemoExpired(demo: DemoState, now = Date.now()) {
  return now - new Date(demo.startedAt).getTime() > demoTimeoutMs;
}

/** Every reply while the walkthrough is open carries the mark. */
export function markDemo(reply: string) {
  return `${demoMark}\n${reply}`;
}

/**
 * Turns the finished draft into the listing the marketer will find when they search.
 *
 * The owner number is their own, which is both the truth and the point: they see exactly what a
 * renter receives after paying, addressed to them.
 */
export function demoListingFrom(draft: DraftProperty, ownerPhone: string): PropertyCandidate {
  return {
    id: "demo",
    propertyCode: "0000",
    ownerPhone,
    title: `${draft.type ?? "دار"} في ${draft.area ?? "منطقة"}`,
    type: draft.type ?? "دار",
    area: draft.area ?? "غير محددة",
    landmark: draft.landmark ?? "غير محدد",
    price: draft.price ?? 0,
    rooms: draft.rooms,
    commission: draft.commission,
    extras: draft.extras
  };
}
