import { getServiceSupabase } from "@/lib/supabase/server";

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

  const { count, error } = await supabase
    .from("notification_log")
    .select("*", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("created_at", since);

  if (error) {
    return null;
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
    failedNotifications
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
    countRecentFailedNotifications(dayAgo)
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
    readAt: new Date().toISOString()
  };
}
