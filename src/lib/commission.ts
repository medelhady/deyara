/**
 * How the office commission is written out.
 *
 * The setting holds an amount and nothing else -- the wording around it belongs here, in one place,
 * rather than being retyped into a settings box for every district. That box used to take a whole
 * sentence, which produced "🏢 عمولة المكتب / *المستأجر يدفع 12 الف للمكتب*": a heading and a
 * sentence saying the same thing.
 *
 * Sentences typed before the change still work. They are passed through untouched, because a
 * half-migrated production must keep showing something true rather than a formatted zero.
 */

/** The line under the amount. Left off a legacy sentence, which already says this in its own words. */
export const commissionNote = "تُدفع للمكتب بعد الاتفاق على الإيجار";

/** True when the stored setting is a plain amount rather than a sentence written the old way. */
export function isPlainAmount(raw: string) {
  const digits = raw.trim().replace(/[\s,،.]/g, "");

  return digits.length > 0 && /^\d+$/.test(digits);
}

/**
 * The commission as a reader sees it: a formatted amount, or the old sentence unchanged.
 *
 * Returns an empty string for an empty setting, which is what hides the line everywhere.
 */
export function formatCommission(raw: string) {
  const trimmed = raw.trim();

  if (!trimmed) {
    return "";
  }

  if (!isPlainAmount(trimmed)) {
    return trimmed;
  }

  const amount = Number(trimmed.replace(/[\s,،.]/g, ""));

  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount)} أوقية`;
}

/**
 * The commission block for a message with room for it -- the listing card and the owner's summary.
 *
 * Empty when nothing is set, so callers spread it and the section disappears on its own.
 */
export function commissionLines(raw: string) {
  const text = formatCommission(raw);

  if (!text) {
    return [];
  }

  return isPlainAmount(raw) ? [text, commissionNote] : [text];
}
