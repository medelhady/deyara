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

  // Without a catch-all notice, a district nobody ticked shows nothing, and any district added later
  // inherits that silence. Say so rather than letting it be discovered in a live conversation.
  const written = notices.filter((notice) => notice.text.trim());
  const hasCatchAll = written.some((notice) => notice.areas.length === 0);
  const uncovered = areas.filter((area) => !notices.some((notice) => notice.areas.includes(area)));

  return (
    <div className="notices-field">
      {notices.length === 0 ? <p className="notices-empty">لا يوجد تنبيه. أضف واحدًا بالأسفل.</p> : null}

      {written.length > 0 && !hasCatchAll ? (
        <p className="notices-warning">
          ⚠️ لا يوجد تنبيه بلا مقاطعات. المقاطعات غير المؤشَّرة لن يظهر لها أي تنبيه
          {uncovered.length > 0 ? `، وهي الآن: ${uncovered.join("، ")}` : ""}. وأي مقاطعة تُضاف
          مستقبلًا ستكون مثلها. اترك تنبيهًا واحدًا بلا تأشير ليغطي البقية.
        </p>
      ) : null}

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
            placeholder="مثال: عاين الدار بنفسك قبل دفع أي مبلغ."
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

      <div className="row-actions">
        <button
          className="button secondary"
          type="button"
          onClick={() => commit([...notices, { text: "", areas: [] }])}
        >
          ＋ إضافة تنبيه
        </button>

        {/* One action rather than a delete per card: the common reason to be here is that the
            commission was typed in by mistake and every card has to go. */}
        {notices.length > 0 ? (
          <button className="button secondary danger-action" type="button" onClick={() => commit([])}>
            مسح كل التنبيهات
          </button>
        ) : null}
      </div>
    </div>
  );
}
