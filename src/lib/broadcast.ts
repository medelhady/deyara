import { getServiceSupabase } from "@/lib/supabase/server";

export type Audience = "all" | "renter" | "owner" | "marketer";

export const audienceLabels: Record<Audience, string> = {
  all: "الجميع",
  renter: "المستأجرون",
  owner: "المؤجرون",
  marketer: "المسوّقون"
};

const audienceNames: Audience[] = ["all", "renter", "owner", "marketer"];

/**
 * Checked against a list rather than with `in`, which walks the prototype chain: "toString" and
 * "constructor" would both have passed as audiences and gone on to the query as a role filter.
 */
export function isAudience(value: string): value is Audience {
  return (audienceNames as string[]).includes(value);
}

/**
 * The phones in an audience, minus anyone blocked.
 *
 * A marketer is someone who has actually referred a person, not merely anyone holding a referral
 * code: every wallet gets a code on first use, so counting codes would make the marketer audience
 * mean "everybody".
 */
export async function resolveAudience(audience: Audience) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return [];
  }

  if (audience === "marketer") {
    const { data } = await supabase
      .from("user_wallets")
      .select("referred_by_phone")
      .not("referred_by_phone", "is", null);

    const referrers = [...new Set((data ?? []).map((row) => String(row.referred_by_phone)))];

    if (referrers.length === 0) {
      return [];
    }

    const { data: active } = await supabase
      .from("users")
      .select("phone")
      .in("phone", referrers)
      .is("blocked_at", null);

    return (active ?? []).map((row) => String(row.phone));
  }

  let query = supabase.from("users").select("phone").is("blocked_at", null);

  if (audience !== "all") {
    query = query.eq("role", audience);
  }

  const { data } = await query;

  return (data ?? []).map((row) => String(row.phone));
}

/**
 * Of the given phones, the ones who have written in the last 24 hours.
 *
 * Only these can receive an ordinary message. WhatsApp refuses free-form text to everyone else, and
 * reaching them needs an approved Marketing template and their consent to receive one. Showing this
 * number before sending is the difference between a broadcast and a queue of silent failures.
 */
export async function reachableNow(phones: string[]) {
  const supabase = getServiceSupabase();

  if (!supabase || phones.length === 0) {
    return [];
  }

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("conversations")
    .select("phone")
    .eq("direction", "inbound")
    .gte("created_at", dayAgo)
    .in("phone", phones);

  return [...new Set((data ?? []).map((row) => String(row.phone)))];
}
