import { getServiceSupabase } from "@/lib/supabase/server";

/**
 * The agencies, read off a screenshot.
 *
 * The offices are not on the bot and will not be for a while; they are on Facebook and TikTok, as a
 * name and a number in a post. Typing those out one by one is the work that never gets done, so the
 * screenshot is the input: one picture in, a row out, and the list becomes something to call from.
 *
 * Nothing here is trusted enough to save on its own. A reading is shown for approval first, because
 * a digit misread in a phone number is a row that looks right and reaches nobody.
 */

export type OfficeDraft = {
  name: string;
  phones: string[];
  platform: string;
  /** The district it works in. The list is only worth calling from if it can be read by area. */
  area: string;
  note: string;
};

export type Office = {
  id: string;
  name: string;
  phones: string[];
  platform: string | null;
  area: string | null;
  note: string | null;
  screenshotPath: string | null;
  createdAt: string;
};

/**
 * One number, in the shape the rest of the system uses.
 *
 * Mauritanian numbers are eight digits and are written every way there is: with 00222, with +222,
 * in pairs, with dashes. What matters is that two screenshots of the same office produce the same
 * string, or the duplicate check is decoration.
 *
 * Returns null for anything too short to be a number, so a price or a date caught by the reader is
 * dropped rather than saved as a contact.
 */
export function normalizePhone(raw: string) {
  const digits = String(raw ?? "").replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  // 00222… and 222… are the same number written twice over.
  const withoutPrefix = digits.startsWith("00") ? digits.slice(2) : digits;

  if (withoutPrefix.length === 8) {
    return `222${withoutPrefix}`;
  }

  if (withoutPrefix.startsWith("222") && withoutPrefix.length === 11) {
    return withoutPrefix;
  }

  // A foreign number is kept as written rather than forced into a Mauritanian shape.
  return withoutPrefix.length >= 8 ? withoutPrefix : null;
}

/** The numbers of one office, cleaned and with repeats removed, in the order they were read. */
export function cleanPhones(values: unknown): string[] {
  const list = Array.isArray(values) ? values : [values];
  const seen = new Set<string>();

  for (const value of list) {
    const phone = normalizePhone(typeof value === "string" || typeof value === "number" ? String(value) : "");

    if (phone) {
      seen.add(phone);
    }
  }

  return Array.from(seen);
}

/**
 * The reader's answer, taken apart defensively.
 *
 * It is a language model reading a photograph: it can return a number instead of a string, a string
 * instead of a list, or a field that is not there at all. None of that should reach the page as a
 * crash -- an empty draft the admin can fill in by hand is always better than an error.
 */
export function parseOfficeReading(raw: unknown): OfficeDraft {
  const value = (raw ?? {}) as Record<string, unknown>;
  const text = (field: unknown) => (typeof field === "string" ? field.trim() : "");

  return {
    name: text(value.name),
    phones: cleanPhones(value.phones ?? value.phone ?? []),
    platform: text(value.platform),
    area: text(value.area),
    note: text(value.note)
  };
}

const prompt = [
  "أنت تقرأ لقطة شاشة لمنشور أو صفحة أو إعلان لمكتب عقاري في موريتانيا.",
  "استخرج فقط ما هو مكتوب في الصورة، ولا تخترع شيئًا غير موجود.",
  "",
  "أرجع JSON بهذه الحقول:",
  '{"name": "اسم المكتب أو الصفحة أو صاحب الإعلان", "phones": ["أرقام التواصل كما ظهرت"], "platform": "المنصة", "area": "المنطقة أو المقاطعة إن ظهرت", "note": "سطر واحد عن نشاطه إن ذكر"}',
  "",
  "قواعد:",
  "- phones: كل الأرقام الظاهرة للتواصل، بالأرقام اللاتينية، ولا تضع فيها أسعارًا ولا تواريخ ولا أعداد مشاهدات.",
  "- platform: استنتجها من شكل الواجهة، واكتب واحدة من: فيسبوك، تيك توك، واتساب، إنستغرام، مجموعة واتساب، أخرى.",
  "- area: اسم المقاطعة أو الحي إن ذُكِر في الصورة، وإلا فاتركه فارغًا — لا تخمّن.",
  "- إن لم يظهر الاسم اترك name فارغًا، وإن لم يظهر رقم اترك phones قائمة فارغة.",
  "- لا تكتب أي نص خارج JSON."
].join("\n");

/**
 * Reads one screenshot.
 *
 * Returns the reading and never throws: the caller shows it for correction, and a failed read has
 * to say why in a sentence the admin can act on rather than disappearing into a log.
 */
export async function readOfficeScreenshot(dataUrl: string) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return { ok: false as const, error: "مفتاح OpenAI غير مضبوط، فلا يمكن قراءة الصور." };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt },
          {
            role: "user",
            content: [
              { type: "text", text: "اقرأ هذه اللقطة وأرجع JSON فقط." },
              { type: "image_url", image_url: { url: dataUrl } }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);

      console.error("Office screenshot read failed", detail);

      return { ok: false as const, error: `تعذّرت قراءة الصورة: ${detail}` };
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;

    if (!content) {
      return { ok: false as const, error: "لم يرجع أي نص من قراءة الصورة." };
    }

    return { ok: true as const, draft: parseOfficeReading(JSON.parse(content)) };
  } catch (error) {
    return {
      ok: false as const,
      error: `تعذّرت قراءة الصورة: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

type OfficeRow = {
  id: string;
  name: string;
  phones: unknown;
  platform: string | null;
  area: string | null;
  note: string | null;
  screenshot_path: string | null;
  created_at: string;
};

function readRow(row: OfficeRow): Office {
  return {
    id: String(row.id),
    name: String(row.name),
    phones: cleanPhones(row.phones),
    platform: row.platform,
    area: row.area,
    note: row.note,
    screenshotPath: row.screenshot_path,
    createdAt: String(row.created_at)
  };
}

// The table ships as a migration an admin has to run, so the likeliest failure is that it is not
// there yet. Say so in Arabic instead of forwarding a PostgREST message nobody can act on.
const missingTableNote =
  "جدول المكاتب real_estate_offices غير موجود. شغّل ملف supabase/add-offices.sql في محرر SQL بـ Supabase ثم أعد المحاولة.";

function missingTable(error: { code?: string; message?: string }) {
  return error.code === "PGRST205" || Boolean(error.message?.includes("real_estate_offices"));
}

export async function listOffices() {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { offices: [] as Office[], error: "قاعدة البيانات غير مربوطة." };
  }

  const { data, error } = await supabase
    .from("real_estate_offices")
    .select("id,name,phones,platform,area,note,screenshot_path,created_at")
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) {
    return { offices: [] as Office[], error: missingTable(error) ? missingTableNote : error.message };
  }

  return { offices: ((data ?? []) as OfficeRow[]).map(readRow), error: null };
}

export async function saveOffice(input: {
  id?: string;
  name: string;
  phones: string[];
  platform: string;
  area: string;
  note: string;
  screenshotPath?: string | null;
}) {
  const name = input.name.trim();
  const phones = cleanPhones(input.phones);

  if (!name) {
    return { saved: false as const, error: "اكتب اسم المكتب." };
  }

  if (phones.length === 0) {
    return { saved: false as const, error: "لا يوجد رقم صالح — بدون رقم لا يمكن الاتصال بالمكتب." };
  }

  const supabase = getServiceSupabase();

  if (!supabase) {
    return { saved: false as const, error: "قاعدة البيانات غير مربوطة." };
  }

  const row: Record<string, unknown> = {
    name,
    phones,
    platform: input.platform.trim() || null,
    area: input.area.trim() || null,
    note: input.note.trim() || null
  };

  /**
   * The screenshot is only written when one is supplied.
   *
   * Editing a name from the table sends no picture, and setting the column to null there would
   * throw away the evidence the row was read from -- the one thing that can settle a doubtful
   * number later.
   */
  if (input.screenshotPath !== undefined) {
    row.screenshot_path = input.screenshotPath;
  }

  const { error } = input.id
    ? await supabase.from("real_estate_offices").update(row).eq("id", input.id)
    : await supabase.from("real_estate_offices").insert(row);

  if (error) {
    return { saved: false as const, error: missingTable(error) ? missingTableNote : error.message };
  }

  return { saved: true as const };
}

export async function deleteOffice(id: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { deleted: false as const, error: "قاعدة البيانات غير مربوطة." };
  }

  const { error } = await supabase.from("real_estate_offices").delete().eq("id", id);

  if (error) {
    return { deleted: false as const, error: error.message };
  }

  return { deleted: true as const };
}
