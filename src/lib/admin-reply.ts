/**
 * The line that marks a reply as written by a person.
 *
 * An admin reply leaves from the bot's own number, so without this it is indistinguishable from
 * something the bot composed. That matters in both directions: it teaches people the bot understands
 * more than it does, and it makes them phrase the next question for a reader who is not there.
 */
export const humanPrefix = "👤 من إدارة الديارة:";

/** WhatsApp refuses free-form text to anyone who has not written within this. */
export const replyWindowMs = 24 * 60 * 60 * 1000;

/** The reply as it reaches WhatsApp: the mark, then what the admin typed. */
export function formatAdminReply(body: string) {
  return `${humanPrefix}\n${body.trim()}`;
}

/**
 * Whether a free-form reply can still be sent.
 *
 * `lastInboundAt` is when they last wrote to us. Never having written is not the same as having
 * written long ago -- one is a number that has no conversation, the other a conversation that has
 * gone cold -- and the two need different sentences, so they are told apart here.
 */
export function canReply(lastInboundAt: string | null | undefined, now = Date.now()) {
  if (!lastInboundAt) {
    return { open: false, everWrote: false, openUntil: null };
  }

  const wroteAt = new Date(lastInboundAt).getTime();

  if (Number.isNaN(wroteAt)) {
    return { open: false, everWrote: false, openUntil: null };
  }

  const openUntil = wroteAt + replyWindowMs;

  return { open: openUntil > now, everWrote: true, openUntil: new Date(openUntil).toISOString() };
}
