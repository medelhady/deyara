import { parseRoomsAnswer } from "@/lib/rooms-answer";

/**
 * The bot's job before there is a market to trade in.
 *
 * With no listings, the full flow -- a video, a fee, an approval wait, paying for a number -- is
 * friction that only makes sense once there is inventory. An owner asked to film a house and pay to
 * list it on a platform with no renters will not do it; he will answer "where is it and how much" in
 * thirty seconds. So the bot asks three questions of each side and writes the answer down.
 *
 * Both sides at once, because the district is what joins them: twenty offers and forty requests in
 * لكصر is the moment the full flow becomes worth switching back on -- and, before that, it is the
 * only thing that persuades an agency to sign up at all.
 */

export type CollectSide = "owner" | "renter";

export type CollectState = {
  side?: CollectSide;
  area?: string;
  /** Rent for an owner, the most a renter will pay. */
  price?: number;
  /** Rooms, features and the nearest landmark, in their own words. */
  specs?: string;
  rooms?: number;
};

/** What the bot still needs before it can save. Null once the entry is complete. */
export function nextCollectQuestion(state: CollectState): "side" | "area" | "price" | "specs" | null {
  if (!state.side) {
    return "side";
  }

  if (!state.area) {
    return "area";
  }

  if (state.price === undefined) {
    return "price";
  }

  if (!state.specs) {
    return "specs";
  }

  return null;
}

const ownerWords = ["1", "عندي", "عندي دار", "عندي منزل", "مؤجر", "موجر", "عندي شقة", "اعرض", "عرض"];
const renterWords = ["2", "ادور", "أدور", "ابحث", "أبحث", "مستاجر", "مستأجر", "نبغي", "اريد", "أريد"];

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

/**
 * Which side of the market they are on.
 *
 * "1" and "2" are what the entry message asks for, and the words are what people write instead --
 * being told to press 1 does not stop anyone from typing "عندي دار". Returns undefined when the
 * message says neither, so the two options can be offered again rather than guessed between.
 */
export function readSide(body: string): CollectSide | undefined {
  const text = normalize(body);

  if (ownerWords.some((word) => text === normalize(word) || text.startsWith(`${normalize(word)} `))) {
    return "owner";
  }

  if (renterWords.some((word) => text === normalize(word) || text.startsWith(`${normalize(word)} `))) {
    return "renter";
  }

  return undefined;
}

/** Latin digits only, as everywhere else a number is asked for here. */
export function readPrice(body: string) {
  const match = body.trim().match(/\d{3,8}/);

  return match ? Number(match[0]) : undefined;
}

/**
 * The specs answer, which carries the room count, the features and the landmark together.
 *
 * Kept whole rather than split into fields: at this stage the point is to have it written down at
 * all, and a sentence an owner wrote is worth more than three columns they abandoned halfway.
 */
export function readSpecs(body: string) {
  const trimmed = body.trim();

  if (!trimmed) {
    return {};
  }

  const parsed = parseRoomsAnswer(trimmed);

  return { specs: trimmed, rooms: parsed.rooms };
}
