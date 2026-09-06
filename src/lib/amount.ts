/**
 * Reads an amount the way people write it.
 *
 * "50 الف" is how a rent is said out loud, and typing five zeros is what someone does only when a
 * form insists. A bot that understands one and not the other is a bot people learn to fight, and the
 * ones who do not learn simply stop answering.
 *
 * Latin digits only, as everywhere else a number is asked for here.
 */

/** Words that multiply the number before them, longest first so "الاف" is not read as "الف". */
const multipliers: Array<{ words: string[]; factor: number }> = [
  { words: ["مليون", "ملیون", "ملاين", "ملايين"], factor: 1_000_000 },
  { words: ["الاف", "آلاف", "ألاف", "الف", "ألف", "آلف", "k", "K"], factor: 1000 }
];

/**
 * The largest number a multiplier is believed about.
 *
 * "50 الف" is fifty thousand; "50000 الف" is somebody who typed the zeros and the word both, and
 * reading it as fifty million would put a house on the books at a price nobody meant.
 */
const multiplierCeiling = 1000;

function normalize(text: string) {
  return text
    .replace(/[أإآ]/g, "ا")
    .replace(/[ـًٌٍَُِّْ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseAmount(body: string): number | undefined {
  const text = normalize(body);
  const match = text.match(/\d{1,9}/);

  if (!match) {
    return undefined;
  }

  const value = Number(match[0]);
  const after = text.slice((match.index ?? 0) + match[0].length);

  for (const { words, factor } of multipliers) {
    for (const word of words) {
      /**
       * Directly after the number, with at most a space between: "50 الف" and "50الف" are the same
       * thought, while "50 دار في الف مكان" is not a multiplier at all.
       *
       * The boundary is written out rather than using \b, which is defined on ASCII word characters
       * only -- against Arabic it never matches, so every multiplier but "k" was silently ignored.
       */
      if (new RegExp(`^\\s?${normalize(word)}(?=$|[^\\p{L}])`, "iu").test(after)) {
        return value <= multiplierCeiling ? value * factor : value;
      }
    }
  }

  return value;
}

/**
 * The least anyone pays for a house here in a month.
 *
 * Nothing rents for sixty ouguiya, so "60" in answer to "how much is the rent" is sixty thousand --
 * which is how the number is said, and how two thirds of the answers arrived. Reading it literally
 * put rents of 60 and 70 on the sheet, and a column of those is unreadable whatever the layout.
 */
const rentFloor = 1000;

/**
 * A rent or a commission, which are said in thousands whether or not the zeros are typed.
 *
 * Separate from parseAmount because it is a fact about houses, not about numbers: a room count of 3
 * must stay 3, and only the fields that hold money may assume the thousands.
 */
export function parseRent(body: string): number | undefined {
  const value = parseAmount(body);

  if (value === undefined || value === 0) {
    return value;
  }

  return value < rentFloor ? value * 1000 : value;
}
