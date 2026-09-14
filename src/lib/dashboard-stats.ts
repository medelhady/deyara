import { getServiceSupabase } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";

export type DashboardStats = {
  totalProperties: number;
  activeProperties: number;
  pendingProperties: number;
  rejectedProperties: number;
  rentedProperties: number;
  contactReveals: number;
  pendingTopups: number;
  /**
   * Pending top-ups whose sender went quiet more than 20 hours ago.
   *
   * These are the expensive ones. The renter has already transferred money, and once 24 hours pass
   * since their receipt WhatsApp refuses the free-form reply that carries their points and the owner
   * number -- so they paid and hear nothing.
   */
  urgentTopups: number;
  pendingWithdrawals: number;
  conversationsToday: number;
  owners: number;
  renters: number;
  /** Null when the notification log table has not been created yet, so the card can stay quiet. */
  failedNotifications: number | null;
  /**
   * What the bot is actually doing right now, and what it has gathered.
   *
   * While collection mode is on, listings, fees and reveals are all zero by design -- so a dashboard
   * built around them shows a business doing nothing, on the day it collected forty requests.
   */
  collectionMode: boolean;
  collectionOffers: number;
  collectionRequests: number;
  collectionToday: number;
  /** People in the list nobody has reached yet. The one number that decides the day's work. */
  collectionUncontacted: number;
  readAt: string;
};

export const emptyStats: DashboardStats = {
  totalProperties: 0,
  activeProperties: 0,
  pendingProperties: 0,
  rejectedProperties: 0,
  rentedProperties: 0,
  contactReveals: 0,
  pendingTopups: 0,
  urgentTopups: 0,
  pendingWithdrawals: 0,
  conversationsToday: 0,
  owners: 0,
  renters: 0,
  failedNotifications: null,
  collectionMode: false,
  collectionOffers: 0,
  collectionRequests: 0,
  collectionToday: 0,
  collectionUncontacted: 0,
  readAt: new Date(0).toISOString()
};

async function countRows(table: string, filters: Array<{ column: string; value: string }> = []) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return 0;
  }

  let query = supabase.from(table).select("*", { count: "exact", head: true });

  for (const filter of filters) {
    query = query.eq(filter.column, filter.value);
  }

  const { count, error } = await query;

  if (error) {
    console.error(`Failed to count ${table}`, error);
    return 0;
  }

  return count ?? 0;
}

/**
 * Counts the notifications that did not arrive in the last day.
 *
 * Returns null rather than 0 when the table is missing, so a dashboard on a database that has not
 * run the migration yet says nothing instead of claiming everything is fine.
 */
async function countRecentFailedNotifications(since: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return null;
  }

  /**
   * Reviewed failures stop counting.
   *
   * A banner that cannot be dismissed warns about a fault the admin has already diagnosed and fixed,
   * for a full day -- which teaches them to ignore the banner, and the next real failure is ignored
   * along with it.
   */
  const { count, error } = await supabase
    .from("notification_log")
    .select("*", { count: "exact", head: true })
    .eq("status", "failed")
    .is("reviewed_at", null)
    .gte("created_at", since);

  if (error) {
    // The column arrives with a migration. Until it is run, count every failure rather than none.
    const { count: withoutColumn, error: fallbackError } = await supabase
      .from("notification_log")
      .select("*", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", since);

    return fallbackError ? null : (withoutColumn ?? 0);
  }

  return count ?? 0;
}

/** Pending top-ups older than the given cutoff, i.e. close to losing their reply window. */
async function countUrgentTopups(before: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return 0;
  }

  const { count, error } = await supabase
    .from("credit_topups")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending")
    .lt("created_at", before);

  return error ? 0 : count ?? 0;
}

/**
 * How many of the people who registered have not been called yet.
 *
 * Counted over people rather than rows: someone who registered a house and a search is one person to
 * call. Both queries are small -- a few hundred phone numbers -- and doing it here means the number
 * that decides the day is on the first screen rather than two clicks away.
 */
async function countUncontacted() {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return 0;
  }

  const [entries, reached] = await Promise.all([
    supabase.from("collection_entries").select("phone").limit(5000),
    supabase.from("users").select("phone").not("contacted_at", "is", null).limit(5000)
  ]);

  if (entries.error) {
    return 0;
  }

  // A missing contacted_at column means nobody has been marked, so everyone is still waiting.
  const contacted = new Set((reached.data ?? []).map((row) => String(row.phone)));
  const people = new Set((entries.data ?? []).map((row) => String(row.phone)));

  let waiting = 0;

  for (const phone of people) {
    if (!contacted.has(phone)) {
      waiting += 1;
    }
  }

  return waiting;
}

export async function loadDashboardStats(): Promise<DashboardStats> {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { ...emptyStats, readAt: new Date().toISOString() };
  }

  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    totalProperties,
    activeProperties,
    pendingProperties,
    rejectedProperties,
    rentedProperties,
    contactReveals,
    pendingTopups,
    urgentTopups,
    pendingWithdrawals,
    owners,
    renters,
    conversations,
    failedNotifications,
    collectionOffers,
    collectionRequests,
    collectionToday,
    collectionUncontacted,
    settings
  ] = await Promise.all([
    countRows("properties"),
    countRows("properties", [{ column: "status", value: "active" }]),
    countRows("properties", [{ column: "status", value: "pending_review" }]),
    countRows("properties", [{ column: "status", value: "rejected" }]),
    countRows("properties", [{ column: "status", value: "rented" }]),
    countRows("contact_requests", [{ column: "status", value: "approved" }]),
    countRows("credit_topups", [{ column: "status", value: "pending" }]),
    countUrgentTopups(new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()),
    countRows("withdrawal_requests", [{ column: "status", value: "pending" }]),
    countRows("users", [{ column: "role", value: "owner" }]),
    countRows("users", [{ column: "role", value: "renter" }]),
    supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .gte("created_at", startOfToday.toISOString()),
    countRecentFailedNotifications(dayAgo),
    countRows("collection_entries", [{ column: "side", value: "owner" }]),
    countRows("collection_entries", [{ column: "side", value: "renter" }]),
    supabase
      .from("collection_entries")
      .select("*", { count: "exact", head: true })
      .gte("created_at", startOfToday.toISOString()),
    countUncontacted(),
    getSettings()
  ]);

  return {
    totalProperties,
    activeProperties,
    pendingProperties,
    rejectedProperties,
    rentedProperties,
    contactReveals,
    pendingTopups,
    urgentTopups,
    pendingWithdrawals,
    owners,
    renters,
    conversationsToday: conversations.count ?? 0,
    failedNotifications,
    collectionMode: settings.collectionMode === "on",
    collectionOffers,
    collectionRequests,
    collectionToday: collectionToday.count ?? 0,
    collectionUncontacted,
    readAt: new Date().toISOString()
  };
}
