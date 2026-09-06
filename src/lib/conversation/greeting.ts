/**
 * Picks the salutation that answers the one the user actually typed.
 *
 * The bot used to open every greeting with "وعليكم السلام", which is the answer to one greeting and
 * to no other: someone who wrote "صباح الخير" got a reply to a message they had not sent, and it
 * reads as a machine that did not listen. GPT is not involved here and never was -- it decides that
 * a message *is* a greeting, and the wording of the reply is ours.
 */

/** Strips the marks and spelling differences that separate the same word typed two ways. */
function normalize(text: string) {
  return text
    .trim()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const salutations: Array<{ answer: string; openings: string[] }> = [
  {
    answer: "صباح النور",
    openings: ["صباح الخير", "صباح النور", "صباحو", "صباح الورد", "good morning"]
  },
  {
    answer: "مساء النور",
    openings: ["مساء الخير", "مساء النور", "مسا الخير", "good evening"]
  },
  {
    // Kept first among the peace greetings by being the longest match, so "السلام عليكم ورحمة الله"
    // is answered in kind rather than falling through to the bare form.
    answer: "وعليكم السلام ورحمة الله وبركاته",
    openings: ["السلام عليكم ورحمه الله وبركاته", "السلام عليكم ورحمه الله"]
  },
  {
    answer: "وعليكم السلام",
    openings: ["السلام عليكم", "السلام", "سلام", "سلام عليكم", "السلام عليكم و رحمه الله"]
  },
  {
    answer: "أهلًا وسهلًا",
    openings: ["اهلا", "اهلين", "هلا", "مرحبا", "مرحبتين", "مرحب", "hello", "hi", "hey"]
  }
];

/** The default answers anything recognised as a greeting whose exact words are not listed. */
const fallbackSalutation = "أهلًا بيك";

/**
 * Whether the message is a greeting and nothing else.
 *
 * salutationFor always answers something, because every greeting deserves one -- but that makes it
 * useless for asking the question, and somebody who opens with السلام عليكم and is answered with a
 * form has been told the machine was not listening.
 */
export function isGreetingOnly(body: string) {
  const text = normalize(body);

  return salutations.some((entry) => entry.openings.some((opening) => text === normalize(opening)));
}

export function salutationFor(body: string) {
  const text = normalize(body);

  // Longest opening first, so "السلام عليكم ورحمة الله" is not claimed by the bare "السلام".
  const candidates = salutations
    .flatMap((entry) => entry.openings.map((opening) => ({ answer: entry.answer, opening: normalize(opening) })))
    .sort((first, second) => second.opening.length - first.opening.length);

  const match = candidates.find(
    (candidate) => text === candidate.opening || text.startsWith(`${candidate.opening} `)
  );

  return match?.answer ?? fallbackSalutation;
}
