/**
 * Finds a referral code in whatever the new user actually sent.
 *
 * The invite link prefills a greeting and the code, because a bare four character token looks like
 * junk and gets cleared before sending -- which loses the referral silently, with the marketer
 * having done everything right.
 *
 * That means the code has to be recognised inside a sentence, not only alone. The words that may
 * introduce it are listed rather than allowing any text, so an ordinary message that happens to
 * contain a four character word is not read as a referral.
 */

/** Greetings and openers the prefilled link uses, plus what someone might type themselves. */
const openers = [
  "سلام",
  "السلام عليكم",
  "السلام",
  "مرحبا",
  "مرحبًا",
  "اهلا",
  "أهلا",
  "ابدأ",
  "ابدا",
  "بدء",
  "كودي",
  "الكود",
  "كود",
  "start",
  "hi",
  "hello"
];

const openerPattern = openers
  .slice()
  // Longest first so "السلام عليكم" is not cut short by "السلام" matching first.
  .sort((first, second) => second.length - first.length)
  .join("|");

const withOpener = new RegExp(`(?:${openerPattern})[\\s,،.:]*([A-Za-z0-9]{4})\\b`, "i");
const alone = /^([A-Za-z0-9]{4})$/;

/**
 * The code in a message, or undefined.
 *
 * A code always carries a letter, which is what separates it from the other four character things
 * people send: a listing number and a result index, both plain digits.
 */
export function findReferralCode(body: string) {
  const text = body.trim();
  const match = text.match(withOpener) ?? text.match(alone);
  const candidate = (match?.[1] ?? "").toUpperCase();

  return /[A-Z]/.test(candidate) ? candidate : undefined;
}
