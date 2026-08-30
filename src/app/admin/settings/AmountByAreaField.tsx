"use client";

type Notice = { text: string; areas: string[] };

/**
 * One amount that applies everywhere, plus optional per-district exceptions.
 *
 * Stored in the same shape the notices editor writes, so the bot reads it unchanged: an entry with
 * no districts is the default, and an entry naming a district overrides it there.
 *
 * The notices editor can express the same thing, but it asks for it the wrong way round -- a stack
 * of cards each with a row of district checkboxes, for what is usually a single number. Here the
 * common case is one box, and a district is only mentioned when it actually differs.
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

  return (
    <div className="amount-field">
      <div className="amount-default">
        <span>المبلغ لكل المقاطعات</span>
        <input
          type="text"
          inputMode="numeric"
          placeholder="مثال: 5000"
          value={fallback}
          onChange={(event) => onChange(serialise(event.target.value, overrides))}
        />
      </div>

      {fallback.trim() === "" && withOverride.length === 0 ? (
        <p className="amount-note">اتركه فارغًا لإخفاء السطر من الإعلانات.</p>
      ) : null}

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
                  onChange(serialise(fallback, { ...overrides, [area]: event.target.value }))
                }
              />
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
