import { getServiceSupabase } from "@/lib/supabase/server";

/**
 * The bot stepping aside while a person answers.
 *
 * Replying from the dashboard used to change nothing about the bot: it kept reading every message as
 * an answer to its own questions, so a user mid-sentence with a human was asked "في أي مقاطعة؟" or
 * told "طلبك مسجّل عندنا ✅" -- the bot talking over the person who had just spoken to them.
 *
 * So a reply hands the conversation over. For twelve hours the bot receives and stores everything and
 * says nothing, the user is told once that a person has their message, and the admin is alerted so a
 * handed-over conversation is not a conversation forgotten.
 */

/**
 * How long the bot stays out of the way.
 *
 * Twelve hours, near enough to WhatsApp's own 24-hour reply window to cover an exchange that runs
 * into the evening, short enough that a handover forgotten overnight is answering again by morning.
 */
export const handoverMs = 12 * 60 * 60 * 1000;

export type Handover = {
  /** Whether the bot must stay silent right now. */
  active: boolean;
  /** When it may speak again, or null when no handover is running. */
  until: string | null;
  /** When this handover's one acknowledgement was sent, or null if it has not been. */
  ackSentAt: string | null;
};

export const noHandover: Handover = { active: false, until: null, ackSentAt: null };

/** Reads a stored row into the shape the bot asks about. Exported for the offline checks. */
export function readHandover(
  row: { human_until?: string | null; human_ack_at?: string | null } | null | undefined,
  now = Date.now()
): Handover {
  const until = row?.human_until ?? null;

  if (!until) {
    return noHandover;
  }

  const ends = new Date(until).getTime();

  // A stored value that is not a date must not silence the bot forever.
  if (Number.isNaN(ends)) {
    return noHandover;
  }

  return { active: ends > now, until, ackSentAt: row?.human_ack_at ?? null };
}

/** When a handover starting now would end. */
export function handoverExpiry(now = Date.now()) {
  return new Date(now + handoverMs).toISOString();
}

/**
 * Whether the user still has to be told a person is answering.
 *
 * Once per handover, not once per message: the point is that silence is explained, and repeating the
 * explanation after every line is the bot interrupting again in a politer voice.
 */
export function needsAcknowledgement(handover: Handover) {
  return handover.active && !handover.ackSentAt;
}

/**
 * Whether a fresh handover should clear the previous acknowledgement.
 *
 * A reply that extends a running handover is the same conversation continuing, so the user is not
 * told twice. A reply weeks later is a new one, and its silence needs explaining again.
 */
export function startsNewHandover(current: Handover) {
  return !current.active;
}

// A missing column means the migration has not been run yet. The bot must keep answering in that
// case, so it is treated as "nobody has handed anything over" rather than logged as a failure.
function missingColumn(message: string | undefined) {
  return Boolean(message && (message.includes("human_until") || message.includes("human_ack_at")));
}

export async function getHandover(phone: string, now = Date.now()): Promise<Handover> {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return noHandover;
  }

  const { data, error } = await supabase
    .from("users")
    .select("human_until,human_ack_at")
    .eq("phone", phone)
    .maybeSingle();

  if (error) {
    if (!missingColumn(error.message)) {
      console.error("Failed to read the handover state", error);
    }

    return noHandover;
  }

  return readHandover(data, now);
}

/** Hands the conversation to a person for the next twelve hours. */
export async function startHandover(phone: string, now = Date.now()) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return;
  }

  const current = await getHandover(phone, now);
  const row: Record<string, unknown> = { phone, human_until: handoverExpiry(now) };

  if (startsNewHandover(current)) {
    row.human_ack_at = null;
  }

  const { error } = await supabase.from("users").upsert(row, { onConflict: "phone" });

  if (error && !missingColumn(error.message)) {
    console.error("Failed to start the handover", error);
  }
}

/** Gives the conversation back to the bot, now rather than at the deadline. */
export async function endHandover(phone: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { ended: false as const, error: "قاعدة البيانات غير مربوطة." };
  }

  const { error } = await supabase
    .from("users")
    .upsert({ phone, human_until: null, human_ack_at: null }, { onConflict: "phone" });

  if (error) {
    return { ended: false as const, error: error.message };
  }

  return { ended: true as const };
}

/** Records that the one acknowledgement of this handover has gone out. */
export async function markAcknowledged(phone: string, now = Date.now()) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return;
  }

  const { error } = await supabase
    .from("users")
    .upsert({ phone, human_ack_at: new Date(now).toISOString() }, { onConflict: "phone" });

  if (error && !missingColumn(error.message)) {
    console.error("Failed to record the handover acknowledgement", error);
  }
}

/**
 * The numbers currently handed over, for a page showing many conversations at once.
 *
 * One query for the whole page rather than one per row.
 */
export async function listHandovers(phones: string[], now = Date.now()) {
  const active = new Map<string, string>();
  const supabase = getServiceSupabase();

  if (!supabase || phones.length === 0) {
    return active;
  }

  const { data, error } = await supabase
    .from("users")
    .select("phone,human_until")
    .in("phone", phones)
    .not("human_until", "is", null);

  if (error) {
    if (!missingColumn(error.message)) {
      console.error("Failed to read the handover states", error);
    }

    return active;
  }

  for (const row of data ?? []) {
    const handover = readHandover(row as { human_until?: string | null }, now);

    if (handover.active && handover.until) {
      active.set(String(row.phone), handover.until);
    }
  }

  return active;
}
