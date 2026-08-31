"use client";

import { commissionLines, isPlainAmount } from "@/lib/commission";

type Notice = { text: string; areas: string[] };

/**
 * One amount that applies everywhere, plus optional per-district exceptions.
 *
 * Stored in the same shape the notices editor writes, so the bot reads it unchanged: an entry with
 * no districts is the default, and an entry naming a district overrides it there.
 *
 * The boxes take digits and nothing else. They used to accept free text, and a whole sentence typed
 * into one produced "🏢 عمولة المكتب / *المستأجر يدفع 12 الف للمكتب*" -- a heading followed by a
 * sentence repeating it -- while the narrow override boxes showed that sentence cut off mid-word,
 * which is what made the page look like a mess. The wording now lives in the bot, and the preview
 * below shows it, so the answer to "what will this look like?" is on screen instead of in WhatsApp.
 */
function parse(value: string): Notice[] {
  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);

    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => item && typeof item.text === "string")
        .map((item) => ({
          text: String(item.text),
          areas: Array.isArray(item.areas) ? item.areas.map(String) : []
        }));
    }
  } catch {
    // A plain value typed before this editor existed is the default amount.
  }

  return [{ text: trimmed, areas: [] }];
}

function serialise(fallback: string, overrides: Record<string, string>) {
  const entries: Notice[] = [];

  if (fallback.trim()) {
    entries.push({ text: fallback.trim(), areas: [] });
  }

  for (const [area, amount] of Object.entries(overrides)) {
    if (amount.trim()) {
      entries.push({ text: amount.trim(), areas: [area] });
    }
  }

  // Nothing set at all stores an empty string, which is what hides the line everywhere.
  return entries.length > 0 ? JSON.stringify(entries) : "";
}

/** Digits only. Typing a sentence into an amount box is the mistake this field exists to prevent. */
function digitsOnly(value: string) {
  return value.replace(/[^\d]/g, "");
}

function Preview({ amount }: { amount: string }) {
  const lines = commissionLines(amount);

  if (lines.length === 0) {
    return null;
  }

  return (
    <div className="amount-preview">
      <span className="amount-preview-label">هكذا سيراها المستأجر</span>
      <div className="amount-preview-body">
        <div>🏢 عمولة المكتب</div>
        {lines.map((line, index) => (
          <div key={line} className={index === 0 ? "amount-preview-strong" : undefined}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AmountByAreaField({
  value,
  areas,
  onChange
}: {
  value: string;
  areas: string[];
  onChange: (next: string) => void;
}) {
  const notices = parse(value);
  const fallback = notices.find((notice) => notice.areas.length === 0)?.text ?? "";

  const overrides: Record<string, string> = {};

  for (const notice of notices) {
    for (const area of notice.areas) {
      overrides[area] = notice.text;
    }
  }

  const withOverride = areas.filter((area) => overrides[area]);

  // Values written before the box was numeric are whole sentences. They keep working in the bot, so
  // the box shows what is actually stored rather than silently dropping it.
  const legacy = [fallback, ...withOverride.map((area) => overrides[area])].filter(
    (text) => text.trim() && !isPlainAmount(text)
  );

  return (
    <div className="amount-field">
      <div className="amount-default">
        <span>المبلغ لكل المقاطعات</span>
        <input
          type="text"
          inputMode="numeric"
          placeholder="مثال: 12000"
          value={fallback}
          onChange={(event) => onChange(serialise(digitsOnly(event.target.value), overrides))}
        />
      </div>

      {legacy.length > 0 ? (
        <div className="notices-warning">
          ⚠️ قيمة قديمة مكتوبة كجملة: «{legacy[0]}». اكتب المبلغ رقمًا فقط — البوت يكتب الجملة من عنده.
        </div>
      ) : null}

      {fallback.trim() === "" && withOverride.length === 0 ? (
        <p className="amount-note">اتركه فارغًا لإخفاء السطر من الإعلانات.</p>
      ) : null}

      <Preview amount={fallback} />

      <details className="amount-overrides" open={withOverride.length > 0}>
        <summary>
          استثناءات حسب المقاطعة
          {withOverride.length > 0 ? ` (${withOverride.length})` : ""}
        </summary>

        <p className="amount-note">
          اترك المقاطعة فارغة لتأخذ المبلغ العام. لا تملأ إلا ما يختلف فعلًا.
        </p>

        <div className="amount-rows">
          {areas.map((area) => (
            <label className="amount-row" key={area}>
              <span>{area}</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder={fallback || "لا شيء"}
                value={overrides[area] ?? ""}
                onChange={(event) =>
                  onChange(serialise(fallback, { ...overrides, [area]: digitsOnly(event.target.value) }))
                }
              />
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
