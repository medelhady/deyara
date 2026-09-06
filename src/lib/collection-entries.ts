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
  /** What the renter will pay the office. Owners only; null when never asked. */
  commission: number | null;
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
  commission?: number;
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
    commission: entry.commission ?? null,
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
    .select("id,phone,side,area,price,specs,rooms,commission,added_by_admin,created_at")
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
    commission: row.commission === null ? null : Number(row.commission),
    addedByAdmin: Boolean(row.added_by_admin),
    createdAt: String(row.created_at)
  }));
}

export type AreaDemand = {
  area: string;
  owners: number;
  renters: number;
};

function normalizeArea(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/[ة]/g, "ه")
    .replace(/[ى]/g, "ي")
    .replace(/[ـًٌٍَُِّْ]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * The district an entry belongs to, out of what the person actually typed.
 *
 * The intake stores the answer as written, which is right -- a request in a district nobody covers
 * is the most useful line on the sheet, and refusing it would lose it. But people answer "في أي
 * مقاطعة" with a whole sentence, and grouping on the raw text gave a summary with one row per
 * sentence, which counts nothing.
 *
 * Matching for display only: the row keeps its own words, and the summary gets a district.
 */
export function matchArea(raw: string, known: string[]) {
  const text = normalizeArea(raw);

  // Longest first, so "دار النعيم" is not claimed by a shorter name inside it.
  const found = [...known]
    .sort((first, second) => second.length - first.length)
    .find((area) => text.includes(normalizeArea(area)));

  return found ?? null;
}

/**
 * The two sides counted per district, busiest first.
 *
 * This is the sheet to take into a meeting: "forty people are looking in لكصر today" is a different
 * conversation from "please list your houses on my new app".
 */
export function summariseByArea(entries: CollectionEntry[], known: string[] = []): AreaDemand[] {
  const counts = new Map<string, AreaDemand>();

  for (const entry of entries) {
    const area = matchArea(entry.area, known) ?? (entry.area.trim() ? "مناطق أخرى" : "بدون مقاطعة");
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
