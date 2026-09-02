/**
 * Reads the room count and whatever else the owner added, out of one answer.
 *
 * Asking only for a number threw away what owners actually say. "3 غرف وجراج السيارات وجلسة" is one
 * thought: the count, and the two things that make this house worth more than the next one at the
 * same price. Insisting on the bare number either loses the extras or teaches the owner to fight the
 * form, and neither is a house a renter can picture.
 */

export type RoomsAnswer = {
  /** Undefined when the answer carried no number at all. */
  rooms?: number;
  /** What was said beyond the count, cleaned up. Undefined when nothing was. */
  extras?: string;
};

const arabicDigits = "٠١٢٣٤٥٦٧٨٩";

function toLatinDigits(text: string) {
  return text.replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)));
}

export function parseRoomsAnswer(body: string): RoomsAnswer {
  const text = toLatinDigits(body).trim();
  const match = text.match(/\d{1,2}/);

  if (!match) {
    // No number at all: the whole sentence is description, and the count stays unanswered so the
    // question is asked again rather than guessed at.
    const extras = clean(text);

    return extras ? { extras } : {};
  }

  const rooms = Number(match[0]);

  // The count and the word right after it -- "3 غرف" -- both go, so the extras do not repeat what the
  // room line already says.
  const withoutCount = text.replace(/\d{1,2}\s*(غرف|غرفة|غرفه|غرفتين|اغرف)?/, " ");
  const extras = clean(withoutCount);

  return extras ? { rooms, extras } : { rooms };
}

/** Trims the joining words and punctuation an answer is left with once the number is removed. */
function clean(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[\s,،.و+\-]+/, "")
    .replace(/[\s,،.]+$/, "")
    .trim();
}
