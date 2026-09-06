"use client";

import { useEffect, useMemo, useState } from "react";

type Entry = {
  id: string;
  phone: string;
  side: "owner" | "renter";
  area: string;
  /** The district this was matched to, or null when the answer was a sentence. */
  matchedArea: string | null;
  price: number | null;
  specs: string | null;
  rooms: number | null;
  commission: number | null;
  addedByAdmin: boolean;
  createdAt: string;
};

type AreaDemand = { area: string; owners: number; renters: number };

function formatPrice(price: number | null) {
  return price === null ? "—" : `${new Intl.NumberFormat("en-US").format(price)} أوقية`;
}

function formatWhen(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ar", { dateStyle: "short", timeStyle: "short" });
}

export function CollectionClient() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [byArea, setByArea] = useState<AreaDemand[]>([]);
  const [message, setMessage] = useState("جار التحميل...");
  const [side, setSide] = useState<"all" | "owner" | "renter">("all");
  const [area, setArea] = useState("all");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ side: "renter", area: "", phone: "", price: "", specs: "" });

  async function load() {
    const response = await fetch(`/api/admin/collection?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error ?? "تعذر التحميل.");
      return;
    }

    setEntries(data.entries ?? []);
    setByArea(data.byArea ?? []);
    setMessage((data.entries ?? []).length ? "" : "لا توجد طلبات ولا عروض بعد.");
  }

  async function add() {
    setSaving(true);

    try {
      const response = await fetch("/api/admin/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await response.json();

      if (!response.ok) {
        setMessage(`⚠️ ${data.error ?? "تعذر الحفظ."}`);
        return;
      }

      setForm({ side: form.side, area: form.area, phone: "", price: "", specs: "" });
      await load();
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const owners = entries.filter((entry) => entry.side === "owner").length;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");

    return entries.filter((entry) => {
      if (side !== "all" && entry.side !== side) {
        return false;
      }

      if (area !== "all" && (entry.matchedArea ?? "مناطق أخرى") !== area) {
        return false;
      }

      if (!term) {
        return true;
      }

      // Digits match the phone, text matches anything they wrote -- one box rather than two, because
      // an admin looking someone up does not know which field will find them.
      return (
        (digits.length >= 3 && entry.phone.replace(/\D/g, "").includes(digits)) ||
        entry.area.toLowerCase().includes(term) ||
        (entry.specs ?? "").toLowerCase().includes(term)
      );
    });
  }, [entries, side, area, search]);

  const sideFilters = [
    { key: "all", label: `الكل (${entries.length})` },
    { key: "owner", label: `🏠 مؤجرون (${owners})` },
    { key: "renter", label: `🔍 مستأجرون (${entries.length - owners})` }
  ] as const;

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">حسب المقاطعة</p>
            <h2>{entries.length} مُدخَلًا</h2>
          </div>
          <a className="button secondary" href="/api/admin/collection/csv">
            ⬇ تصدير إكسل
          </a>
        </div>

        {message ? <p>{message}</p> : null}

        {byArea.length > 0 ? (
          <div className="demand-grid">
            {/* Each district is a button, not a row: the count is only useful if you can then see who
                it is made of. */}
            {byArea.map((row) => (
              <button
                className={area === row.area ? "demand-card is-active" : "demand-card"}
                type="button"
                key={row.area}
                onClick={() => setArea(area === row.area ? "all" : row.area)}
              >
                <strong>{row.area}</strong>
                <span>
                  🏠 {row.owners} · 🔍 {row.renters}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">القائمة</p>
            <h2>{visible.length} ظاهرًا</h2>
          </div>
          {area !== "all" || side !== "all" || search ? (
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setArea("all");
                setSide("all");
                setSearch("");
              }}
            >
              إلغاء الفلترة
            </button>
          ) : null}
        </div>

        <input
          type="search"
          className="property-search"
          placeholder="ابحث برقم الهاتف أو بأي كلمة كتبها"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <div className="filters-bar">
          {sideFilters.map((filter) => (
            <button
              className={side === filter.key ? "active" : ""}
              type="button"
              key={filter.key}
              onClick={() => setSide(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {area !== "all" ? <p className="amount-note">المقاطعة: {area}</p> : null}

        {visible.length === 0 ? (
          <p>لا شيء يطابق هذه الفلترة.</p>
        ) : (
          <div className="demand-list">
            {visible.map((entry) => {
              const number = entry.phone.replace("whatsapp:", "").replace(/\D/g, "");
              const owner = entry.side === "owner";

              return (
                /**
                 * Two lines and no expanding.
                 *
                 * Everything an admin does from this page ends in a WhatsApp message, and the old row
                 * made that two clicks away behind a fold. What they wrote is shown whole rather than
                 * cut at forty-eight characters, because the sentence is the request -- "ثلاث غرف
                 * وجلسة وقريبة من ا…" tells you nothing you can act on.
                 */
                <article className="demand-row" key={entry.id}>
                  <div className="demand-row-head">
                    <span className={owner ? "demand-tag is-owner" : "demand-tag"}>
                      {owner ? "🏠 مؤجر" : "🔍 مستأجر"}
                    </span>
                    <strong className="demand-amount">
                      {owner ? "" : "حتى "}
                      {formatPrice(entry.price)}
                    </strong>
                    {entry.matchedArea ? <span className="demand-chip">{entry.matchedArea}</span> : null}
                    {entry.rooms ? <span className="demand-chip">{entry.rooms} غرف</span> : null}
                    {owner && entry.commission ? (
                      <span className="demand-chip">عمولة {formatPrice(entry.commission)}</span>
                    ) : null}
                    <span className="demand-when">{formatWhen(entry.createdAt)}</span>
                  </div>

                  {entry.specs ? <p className="demand-said">{entry.specs}</p> : null}

                  <div className="demand-row-foot">
                    <a className="button secondary" href={`https://wa.me/${number}`} target="_blank" rel="noreferrer">
                      💬 راسله
                    </a>
                    <span dir="ltr">+{number}</span>
                    {entry.matchedArea !== entry.area.trim() ? <span>كتب: {entry.area}</span> : null}
                    {entry.addedByAdmin ? <span>إدخال يدوي</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <details className="panel">
        <summary>
          <strong>إدخال يدوي</strong> — أضف من تعليقات فيسبوك وتيك توك
        </summary>

        <p>ما جمعته بيدك هو نفس الطلب، وتركه في التعليقات يعني إعادة قراءتها كل مرة.</p>

        <div className="settings-grid">
          <label className="setting-field">
            <span>الجهة</span>
            <select value={form.side} onChange={(event) => setForm({ ...form, side: event.target.value })}>
              <option value="renter">مستأجر يبحث</option>
              <option value="owner">مؤجر يعرض</option>
            </select>
          </label>
          <label className="setting-field">
            <span>المقاطعة</span>
            <input value={form.area} onChange={(event) => setForm({ ...form, area: event.target.value })} />
          </label>
          <label className="setting-field">
            <span>الرقم</span>
            <input
              inputMode="numeric"
              placeholder="22248404037"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
            <small>بدونه لا يمكن مراسلته حين يتوفر ما يناسبه.</small>
          </label>
          <label className="setting-field">
            <span>السعر</span>
            <input
              inputMode="numeric"
              value={form.price}
              onChange={(event) => setForm({ ...form, price: event.target.value })}
            />
          </label>
          <label className="setting-field">
            <span>المواصفات</span>
            <input value={form.specs} onChange={(event) => setForm({ ...form, specs: event.target.value })} />
          </label>
        </div>

        <button className="button" type="button" disabled={saving} onClick={() => void add()}>
          {saving ? "جار الحفظ..." : "أضف"}
        </button>
      </details>
    </>
  );
}
