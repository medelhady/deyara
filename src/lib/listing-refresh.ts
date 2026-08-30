import { getServiceSupabase } from "@/lib/supabase/server";
import { getMessage } from "@/lib/bot-messages";
import { getSettings } from "@/lib/settings";
import { sendNotification } from "@/lib/notifications";

export type RefreshOutcome = {
  phone: string;
  listings: number;
  sent: boolean;
  error?: string;
};

/**
 * Reminds owners to retire listings that are no longer available.
 *
 * The failure this exists to prevent costs a renter money: they pay for the number of a house that
 * was let weeks ago. An owner has no reason to come back and say so on their own, so they are asked.
 *
 * Two rules keep it from becoming nagging. Only listings that have sat untouched longer than the
 * configured window are counted -- someone who posted yesterday hears nothing -- and an owner
 * reminded recently is skipped, which is read from the notification log rather than a new column.
 */
export async function findOwnersToRemind(nowMs = Date.now()) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return [];
  }

  const { listingRefreshHours } = await getSettings();
  const staleBefore = new Date(nowMs - listingRefreshHours * 60 * 60 * 1000).toISOString();

  const { data: properties, error } = await supabase
    .from("properties")
    .select("owner_phone,property_code,area,landmark,updated_at")
    .eq("status", "active")
    .lt("updated_at", staleBefore);

  if (error) {
    console.error("Failed to read listings for the refresh reminder", error);
    return [];
  }

  const byOwner = new Map<string, Array<{ code: string; area: string; landmark: string }>>();

  for (const row of properties ?? []) {
    const owner = String(row.owner_phone ?? "");

    if (!owner) {
      continue;
    }

    byOwner.set(owner, [
      ...(byOwner.get(owner) ?? []),
      {
        code: String(row.property_code ?? ""),
        area: String(row.area ?? ""),
        landmark: String(row.landmark ?? "")
      }
    ]);
  }

  if (byOwner.size === 0) {
    return [];
  }

  // Anyone already reminded inside the window is left alone. The log is the record of what was
  // sent, so it is also the record of who not to send to again.
  const { data: recent } = await supabase
    .from("notification_log")
    .select("phone")
    .eq("kind", "listing_refresh")
    .gte("created_at", staleBefore)
    .in("phone", [...byOwner.keys()]);

  const remindedRecently = new Set((recent ?? []).map((row) => String(row.phone)));

  return [...byOwner.entries()]
    .filter(([owner]) => !remindedRecently.has(owner))
    .map(([phone, listings]) => ({ phone, listings }));
}

export async function sendRefreshReminders(nowMs = Date.now()): Promise<RefreshOutcome[]> {
  const owners = await findOwnersToRemind(nowMs);
  const outcomes: RefreshOutcome[] = [];

  for (const owner of owners) {
    // The landmark is included for the same reason as in the listings summary: this message asks the
    // owner to name a house, and a code plus a district does not tell two of theirs apart.
    const lines = owner.listings
      .map((listing) => `• *${listing.code}* — ${listing.area}${listing.landmark ? ` — ${listing.landmark}` : ""}`)
      .join("\n");

    const body = await getMessage("listing_refresh", {
      count: owner.listings.length,
      listings: lines,
      firstCode: owner.listings[0]?.code
    });

    const result = await sendNotification(owner.phone, body, "listing_refresh", {
      name: "listing_refresh",
      language: "ar",
      parameters: [String(owner.listings.length)]
    });

    outcomes.push({
      phone: owner.phone,
      listings: owner.listings.length,
      sent: result.ok,
      error: result.ok ? undefined : result.explained
    });
  }

  return outcomes;
}
