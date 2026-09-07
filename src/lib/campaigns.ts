import { getServiceSupabase } from "@/lib/supabase/server";

/**
 * The answer for whoever is not renting a house.
 *
 * A marketer, a merchant or a partner who writes to the bot falls through every path it has: it asks
 * them which district and how much, because those are the only questions it knows. What they need is
 * one explanation of how the thing works -- usually a video the admin already has -- and it has to
 * arrive the moment they write the word printed on the advert.
 *
 * Rows rather than code: an advert goes out in the morning and its answer must be able to exist by
 * noon, worded by the person who wrote the advert, without a deploy.
 */

export type Campaign = {
  id: string;
  name: string;
  keywords: string[];
  replyText: string;
  videoPath: string | null;
  active: boolean;
  hits: number;
  lastHitAt: string | null;
};

/**
 * Short words catch everything.
 *
 * A two-letter trigger would fire inside ordinary sentences and answer a renter with an advert for
 * merchants, so the shortest allowed keyword is three characters.
 */
export const minimumKeywordLength = 3;

/**
 * Written the way people actually type: no diacritics, أ/إ/آ all read as ا, ة as ه, ى as ي.
 *
 * The person is copying a word out of an advert on their phone, and refusing them over a hamza is
 * refusing the customer the advert was paid for.
 */
export function normalizeCampaignText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/[ة]/g, "ه")
    .replace(/[ى]/g, "ي")
    .replace(/[ـًٌٍَُِّْ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The keywords box as typed -- commas, Arabic commas or one per line -- read into a list. */
export function parseKeywords(raw: string) {
  const seen = new Set<string>();

  for (const part of raw.split(/[,،\n]/)) {
    const keyword = normalizeCampaignText(part);

    if (keyword.length >= minimumKeywordLength) {
      seen.add(keyword);
    }
  }

  return Array.from(seen);
}

/** How far apart two words are, counting one edit at a time. Used only for single-word typos. */
function editDistance(first: string, second: string) {
  const rows = Array.from({ length: first.length + 1 }, () => Array<number>(second.length + 1).fill(0));

  for (let row = 0; row <= first.length; row += 1) {
    rows[row][0] = row;
  }

  for (let column = 0; column <= second.length; column += 1) {
    rows[0][column] = column;
  }

  for (let row = 1; row <= first.length; row += 1) {
    for (let column = 1; column <= second.length; column += 1) {
      const cost = first[row - 1] === second[column - 1] ? 0 : 1;

      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + cost
      );
    }
  }

  return rows[first.length][second.length];
}

/**
 * Whether one message triggers one keyword.
 *
 * A keyword of several words is looked for as a phrase. A single word has to appear as a word --
 * never as a fragment inside another -- or the advert for merchants answers anyone whose sentence
 * happens to contain those letters. One typo is forgiven on a word of four letters or more, which is
 * the difference between a marketer reaching the answer and being asked which district they want.
 */
function keywordMatches(words: string[], text: string, keyword: string) {
  if (keyword.includes(" ")) {
    return text.includes(keyword);
  }

  return words.some((word) => word === keyword || (keyword.length >= 4 && editDistance(word, keyword) <= 1));
}

/**
 * The campaign a message triggers, or nothing.
 *
 * The longest matching keyword wins: a specific trigger written for one advert must not be taken by
 * a general one that happens to share a word.
 */
export function matchCampaign<T extends { keywords: string[]; active: boolean }>(
  body: string,
  campaigns: T[]
): T | undefined {
  const text = normalizeCampaignText(body);

  if (!text) {
    return undefined;
  }

  const words = text.split(" ");
  const matches: Array<{ campaign: T; length: number }> = [];

  for (const campaign of campaigns) {
    if (!campaign.active) {
      continue;
    }

    for (const keyword of campaign.keywords) {
      if (keywordMatches(words, text, keyword)) {
        matches.push({ campaign, length: keyword.length });
      }
    }
  }

  return matches.sort((first, second) => second.length - first.length)[0]?.campaign;
}

type CampaignRow = {
  id: string;
  name: string;
  keywords: string | null;
  reply_text: string | null;
  video_path: string | null;
  active: boolean | null;
  hits: number | null;
  last_hit_at: string | null;
};

function readRow(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    keywords: parseKeywords(row.keywords ?? ""),
    replyText: row.reply_text ?? "",
    videoPath: row.video_path,
    active: row.active !== false,
    hits: row.hits ?? 0,
    lastHitAt: row.last_hit_at
  };
}

// The table missing means the migration has not been run. The bot must keep answering everyone else,
// so that reads as "no campaigns" rather than as a failure worth logging on every message.
function missingTable(error: { code?: string; message?: string }) {
  return error.code === "PGRST205" || Boolean(error.message?.includes("bot_campaigns"));
}

const missingTableNote =
  "جدول الحملات bot_campaigns غير موجود. شغّل ملف supabase/add-campaigns.sql في محرر SQL بـ Supabase ثم أعد المحاولة.";

let cache: { at: number; rows: Campaign[] } | null = null;
const cacheMs = 30 * 1000;

export function clearCampaignCache() {
  cache = null;
}

/**
 * The campaigns as the bot sees them, cached for half a minute.
 *
 * This runs on every incoming message, and an edit that takes thirty seconds to show is a fair price
 * for not querying the table once per person.
 */
export async function getActiveCampaigns(now = Date.now()): Promise<Campaign[]> {
  if (cache && now - cache.at < cacheMs) {
    return cache.rows;
  }

  const supabase = getServiceSupabase();

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("bot_campaigns")
    .select("id,name,keywords,reply_text,video_path,active,hits,last_hit_at")
    .eq("active", true);

  if (error) {
    if (!missingTable(error)) {
      console.error("Failed to read the campaigns", error);
    }

    return [];
  }

  const rows = ((data ?? []) as CampaignRow[]).map(readRow);

  cache = { at: now, rows };

  return rows;
}

/** Every campaign, live or paused, for the dashboard. */
export async function listCampaigns() {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { campaigns: [] as Campaign[], error: "قاعدة البيانات غير مربوطة." };
  }

  const { data, error } = await supabase
    .from("bot_campaigns")
    .select("id,name,keywords,reply_text,video_path,active,hits,last_hit_at")
    .order("created_at", { ascending: false });

  if (error) {
    return { campaigns: [] as Campaign[], error: missingTable(error) ? missingTableNote : error.message };
  }

  return { campaigns: ((data ?? []) as CampaignRow[]).map(readRow), error: null };
}

export type CampaignInput = {
  id?: string;
  name: string;
  keywords: string;
  replyText: string;
  videoPath?: string | null;
  active: boolean;
};

/** Writes one campaign, refusing the two mistakes that make it answer nobody or answer everybody. */
export async function saveCampaign(input: CampaignInput) {
  const name = input.name.trim();
  const keywords = parseKeywords(input.keywords);
  const replyText = input.replyText.trim();

  if (!name) {
    return { saved: false as const, error: "اكتب اسمًا للحملة حتى تعرفها لاحقًا." };
  }

  if (keywords.length === 0) {
    return {
      saved: false as const,
      error: `اكتب كلمة تشغيل واحدة على الأقل، من ${minimumKeywordLength} حروف فأكثر — الكلمات القصيرة تلتقط رسائل لا علاقة لها بالإعلان.`
    };
  }

  if (!replyText && !input.videoPath) {
    return { saved: false as const, error: "الحملة بلا رد: اكتب نصًا أو أرفق فيديو." };
  }

  const supabase = getServiceSupabase();

  if (!supabase) {
    return { saved: false as const, error: "قاعدة البيانات غير مربوطة." };
  }

  const row = {
    name,
    // Stored normalised, which is also what the box shows back: a keyword that looks different from
    // the one being matched is a keyword nobody can debug.
    keywords: keywords.join("، "),
    reply_text: replyText,
    video_path: input.videoPath ?? null,
    active: input.active,
    updated_at: new Date().toISOString()
  };

  const { error } = input.id
    ? await supabase.from("bot_campaigns").update(row).eq("id", input.id)
    : await supabase.from("bot_campaigns").insert(row);

  if (error) {
    return { saved: false as const, error: missingTable(error) ? missingTableNote : error.message };
  }

  clearCampaignCache();

  return { saved: true as const };
}

export async function deleteCampaign(id: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { deleted: false as const, error: "قاعدة البيانات غير مربوطة." };
  }

  const { error } = await supabase.from("bot_campaigns").delete().eq("id", id);

  if (error) {
    return { deleted: false as const, error: error.message };
  }

  clearCampaignCache();

  return { deleted: true as const };
}

/**
 * One more person reached.
 *
 * The count is the whole feedback loop for an advert: without it there is no way to tell a word
 * nobody writes from a word nobody sees.
 */
export async function recordCampaignHit(id: string, hits: number) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return;
  }

  const { error } = await supabase
    .from("bot_campaigns")
    .update({ hits: hits + 1, last_hit_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("Failed to count a campaign hit", error);
  }
}
