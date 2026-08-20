"use client";

type Notice = {
  text: string;
  areas: string[];
};

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
        .map((item) => ({ text: String(item.text), areas: Array.isArray(item.areas) ? item.areas.map(String) : [] }));
    }
  } catch {
    // A plain notice typed before this editor existed still opens here.
  }

  return [{ text: trimmed, areas: [] }];
}

/**
 * Writes a notice per district group. The stored value stays a single settings string, so the bot
 * reads it the same way whether it was typed by hand or built here.
 */
export function NoticesField({
  value,
  areas,
  onChange
}: {
  value: string;
  areas: string[];
  onChange: (next: string) => void;
}) {
  const notices = parse(value);

  // Keep empties: a notice starts blank and has to survive long enough to be typed into. The bot
  // skips any notice with no text.
  function commit(next: Notice[]) {
    onChange(next.length === 0 ? "" : JSON.stringify(next));
  }

  function update(index: number, patch: Partial<Notice>) {
    commit(notices.map((notice, position) => (position === index ? { ...notice, ...patch } : notice)));
  }

  function toggleArea(index: number, area: string) {
    const current = notices[index].areas;
    update(index, {
      areas: current.includes(area) ? current.filter((item) => item !== area) : [...current, area]
    });
  }

  // A district can only belong to one notice, otherwise which one wins would be a guess.
  function claimedElsewhere(index: number, area: string) {
    return notices.some((notice, position) => position !== index && notice.areas.includes(area));
  }

  return (
    <div className="notices-field">
      {notices.length === 0 ? <p className="notices-empty">لا يوجد تنبيه. أضف واحدًا بالأسفل.</p> : null}

      {notices.map((notice, index) => (
        <div className="notice-card" key={index}>
          <div className="notice-head">
            <strong>تنبيه {index + 1}</strong>
            <button type="button" onClick={() => commit(notices.filter((_, position) => position !== index))}>
              حذف
            </button>
          </div>

          <textarea
            rows={2}
            placeholder="مثال: المستأجر يدفع 12 ألف عند الاتفاق للسمسار."
            value={notice.text}
            onChange={(event) => update(index, { text: event.target.value })}
          />

          <div className="notice-areas">
            {areas.map((area) => {
              const taken = claimedElsewhere(index, area);

              return (
                <label key={area} className={taken ? "area-chip taken" : "area-chip"}>
                  <input
                    type="checkbox"
                    checked={notice.areas.includes(area)}
                    disabled={taken}
                    onChange={() => toggleArea(index, area)}
                  />
                  <span>{area}</span>
                </label>
              );
            })}
          </div>

          <small>
            {notice.areas.length === 0
              ? "يسري على كل المقاطعات التي لم تُؤشَّر في تنبيه آخر."
              : `يسري على ${notice.areas.length} مقاطعة.`}
          </small>
        </div>
      ))}

      <button
        className="button secondary"
        type="button"
        onClick={() => commit([...notices, { text: "", areas: [] }])}
      >
        ＋ إضافة تنبيه
      </button>
    </div>
  );
}
