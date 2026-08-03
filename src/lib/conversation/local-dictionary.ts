import { getServiceSupabase } from "@/lib/supabase/server";

export type BotDictionaryCategory = "greeting" | "intro" | "renter_search" | "owner_listing" | "area";

export type RuntimeDictionary = {
  greetings: string[];
  introPhrases: string[];
  renterSearchPhrases: string[];
  ownerListingPhrases: string[];
  areas: string[];
};

export const greetings = [
  "السلام",
  "السلام عليكم",
  "سلام",
  "اهلا",
  "أهلا",
  "مرحبا",
  "مساء الخير",
  "صباح الخير"
];

export const introPhrases = [
  "شات",
  "ابدأ",
  "بدء",
  "start",
  "hello",
  "hi"
];

export const renterSearchPhrases = [
  "اريد",
  "أريد",
  "ابحث",
  "أبحث",
  "نبحث",
  "ندور",
  "نفتش",
  "احتاج",
  "أحتاج",
  "باغي",
  "بغيت",
  "عايز",
  "عاوز",
  "حبيت",
  "كراء",
  "للكراء",
  "للايجار",
  "للإيجار",
  "اكري",
  "أكري",
  "كاري"
];

export const ownerListingPhrases = [
  "عندي",
  "لدي",
  "عندي دار",
  "عندي شقة",
  "نأجر",
  "ناجر",
  "للكراء عندي",
  "للإيجار عندي",
  "متوفر عندي"
];

export function includesAny(text: string, phrases: string[]) {
  return phrases.some((phrase) => text.includes(phrase));
}

export function equalsAny(text: string, phrases: string[]) {
  return phrases.some((phrase) => text === phrase);
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export async function getRuntimeDictionary(): Promise<RuntimeDictionary> {
  const dictionary: RuntimeDictionary = {
    greetings,
    introPhrases,
    renterSearchPhrases,
    ownerListingPhrases,
    areas: []
  };
  const supabase = getServiceSupabase();

  if (!supabase) {
    return dictionary;
  }

  const { data, error } = await supabase
    .from("bot_dictionary")
    .select("category, phrase")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load bot dictionary", error);
    return dictionary;
  }

  for (const item of data ?? []) {
    const phrase = String(item.phrase ?? "").trim();

    if (!phrase) {
      continue;
    }

    if (item.category === "greeting") {
      dictionary.greetings.push(phrase);
    }

    if (item.category === "intro") {
      dictionary.introPhrases.push(phrase);
    }

    if (item.category === "renter_search") {
      dictionary.renterSearchPhrases.push(phrase);
    }

    if (item.category === "owner_listing") {
      dictionary.ownerListingPhrases.push(phrase);
    }

    if (item.category === "area") {
      dictionary.areas.push(phrase);
    }
  }

  return {
    greetings: unique(dictionary.greetings),
    introPhrases: unique(dictionary.introPhrases),
    renterSearchPhrases: unique(dictionary.renterSearchPhrases),
    ownerListingPhrases: unique(dictionary.ownerListingPhrases),
    areas: unique(dictionary.areas)
  };
}
