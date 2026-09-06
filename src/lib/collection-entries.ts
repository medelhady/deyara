import { getServiceSupabase } from "@/lib/supabase/server";
import type { CollectSide } from "@/lib/conversation/collect";

/**
 * Reading and writing what the bot collects before there is a market.
 *
 * Kept out of `properties` deliberately: an entry here has no video, no fee and no approval, and
 * must never be searchable as a listing. What it is instead is the demand list -- the thing that
 * persuades an agency to sign up, and that tells you which districts to open first.
 */

export type CollectionEntry = {
  id: string;
  phone: string;
  side: CollectSide;
  area: string;
  price: number | null;
  specs: string | null;
  rooms: number | null;
  addedByAdmin: boolean;
  createdAt: string;
};

export async function saveCollectionEntry(entry: {
  phone: string;
  side: CollectSide;
  area: string;
  price?: number;
  specs?: string;
  rooms?: number;
  addedByAdmin?: boolean;
}) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { saved: false as const };
  }

  const { error } = await supabase.from("collection_entries").insert({
    phone: entry.phone,
    side: entry.side,
    area: entry.area,
    price: entry.price ?? null,
    specs: entry.specs ?? null,
    rooms: entry.rooms ?? null,
    added_by_admin: entry.addedByAdmin ?? false
  });

  if (error) {
    console.error("Failed to save a collection entry", error);
    return { saved: false as const, error: error.message };
  }

  return { saved: true as const };
}

export async function listCollectionEntries(): Promise<CollectionEntry[]> {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("collection_entries")
    .select("id,phone,side,area,price,specs,rooms,added_by_admin,created_at")
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) {
    console.error("Failed to read collection entries", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    phone: String(row.phone),
    side: row.side as CollectSide,
    area: String(row.area),
    price: row.price === null ? null : Number(row.price),
    specs: (row.specs as string | null) ?? null,
    rooms: row.rooms === null ? null : Number(row.rooms),
    addedByAdmin: Boolean(row.added_by_admin),
    createdAt: String(row.created_at)
  }));
}

export type AreaDemand = {
  area: string;
  owners: number;
  renters: number;
};

/**
 * The two sides counted per district, busiest first.
 *
 * This is the sheet to take into a meeting: "forty people are looking in لكصر today" is a different
 * conversation from "please list your houses on my new app".
 */
export function summariseByArea(entries: CollectionEntry[]): AreaDemand[] {
  const counts = new Map<string, AreaDemand>();

  for (const entry of entries) {
    const area = entry.area.trim() || "بدون مقاطعة";
    const current = counts.get(area) ?? { area, owners: 0, renters: 0 };

    if (entry.side === "owner") {
      current.owners += 1;
    } else {
      current.renters += 1;
    }

    counts.set(area, current);
  }

  return [...counts.values()].sort(
    (first, second) => second.owners + second.renters - (first.owners + first.renters)
  );
}
