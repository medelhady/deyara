"use client";

import { useEffect, useMemo, useState } from "react";
import { ReplyBox, type ReplyWindow } from "../ReplyBox";

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
  /** When an admin last reached this person. Null means nobody has. */
  contactedAt: string | null;
};

type AreaDemand = { area: string; owners: number; renters: number };

type Message = { id: string; direction: string; message_type: string; body: string | null; created_at: string };

function formatPrice(price: number | null) {
  return price === null ? "—" : `${new Intl.NumberFormat("en-US").format(price)} أوقية`;
}

/** A location that was written as a sentence, cut to something a row can carry. */
function shortenArea(text: string, limit = 24) {
  const clean = text.replace(/\s+/g, " ").trim();

  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean || "بلا مقاطعة";
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
  const [reached, setReached] = useState<"all" | "waiting" | "done">("all");
  const [area, setArea] = useState("all");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [openPhone, setOpenPhone] = useState<string | null>(null);
  const [thread, setThread] = useState<Message[] | null>(null);
  const [replyWindow, setReplyWindow] = useState<ReplyWindow | null>(null);
  const [handoverUntil, setHandoverUntil] = useState<string | null>(null);

  /**
   * The conversation behind an entry.
   *
   * Half the districts arrived as a sentence or as "2", and the row alone cannot say what the person
   * meant. What they actually typed can -- and it is already stored, one table over.
   */
  async function openThread(phone: string) {
    if (openPhone === phone) {
      setOpenPhone(null);
      setThread(null);
      setReplyWindow(null);
      setHandoverUntil(null);
      return;
    }

    setOpenPhone(phone);
    await loadThread(phone);
  }

  /** Re-reads one conversation without closing it, which is what a reply needs afterwards. */
  async function loadThread(phone: string) {
    setThread(null);
    setReplyWindow(null);

    const response = await fetch(`/api/admin/conversations?phone=${encodeURIComponent(phone)}&t=${Date.now()}`, {
      cache: "no-store"
    });
    const data = await response.json();

    setThread(response.ok ? (data.messages ?? []) : []);
    setReplyWindow(response.ok ? (data.window ?? null) : null);
    setHandoverUntil(response.ok ? (data.handoverUntil ?? null) : null);
  }
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

  /**
   * Records a call made outside the dashboard.
   *
   * Replying from here marks them already; this is for the ones reached from a phone, which is every
   * one whose 24-hour window has closed.
   */
  async function markContacted(phone: string, contacted: boolean) {
    const response = await fetch("/api/admin/collection/contacted", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, contacted })
    });
    const data = await response.json();

    await load();

    // After the reload, never before: load() rewrites the same line, and a failure announced first
    // was erased a moment later -- leaving a mark that silently did not save.
    if (!response.ok) {
      setMessage(`⚠️ ${data.error ?? "تعذر حفظ الوسم."}`);
    }
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

      // The question that decides the day is not who is there but who has not been called yet.
      if (reached === "waiting" && entry.contactedAt) {
        return false;
      }

      if (reached === "done" && !entry.contactedAt) {
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
  }, [entries, side, area, search, reached]);

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
            <h2>{entries.length} طلبًا</h2>
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
          {area !== "all" || side !== "all" || search || reached !== "all" ? (
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setArea("all");
                setSide("all");
                setSearch("");
                setReached("all");
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

        <div className="filters-bar">
          {(
            [
              { key: "all", label: `الكل` },
              { key: "waiting", label: `⏳ لم أتواصل (${entries.filter((entry) => !entry.contactedAt).length})` },
              { key: "done", label: `✅ تواصلت (${entries.filter((entry) => entry.contactedAt).length})` }
            ] as const
          ).map((filter) => (
            <button
              className={reached === filter.key ? "active" : ""}
              type="button"
              key={filter.key}
              onClick={() => setReached(filter.key)}
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
                <article className={entry.contactedAt ? "demand-row is-reached" : "demand-row"} key={entry.id}>
                  <button className="demand-row-head" type="button" onClick={() => void openThread(entry.phone)}>
                    <span className="demand-open">{openPhone === entry.phone ? "▾" : "▸"}</span>
                    <span className={owner ? "demand-tag is-owner" : "demand-tag"}>
                      {owner ? "🏠 مؤجر" : "🔍 مستأجر"}
                    </span>
                    {/* The district leads and is never missing: it is the key an admin works by, and
                        an entry whose answer was a sentence used to show no location at all up here --
                        only a footnote at the bottom of the card. */}
                    <strong className="demand-area">
                      {/* ?? would keep an empty string, and a pin with nothing after it is worse than
                          no pin: it reads as a district whose name failed to load. */}
                      📍 {entry.matchedArea?.trim() || shortenArea(entry.area)}
                    </strong>
                    <strong className="demand-amount">
                      {owner ? "" : "حتى "}
                      {formatPrice(entry.price)}
                    </strong>
                    {entry.rooms ? <span className="demand-chip">{entry.rooms} غرف</span> : null}
                    {owner && entry.commission ? (
                      <span className="demand-chip">عمولة {formatPrice(entry.commission)}</span>
                    ) : null}
                    {entry.contactedAt ? <span className="demand-tag is-reached">✅ تواصلت</span> : null}
                    <span className="demand-when">{formatWhen(entry.createdAt)}</span>
                  </button>

                  {entry.specs ? <p className="demand-said">{entry.specs}</p> : null}

                  <div className="demand-row-foot">
                    {/* Opens the conversation in place. Replying from here is logged, marked as
                        written by a person, and does not require finding the number on a phone. */}
                    <button className="button secondary" type="button" onClick={() => void openThread(entry.phone)}>
                      💬 {openPhone === entry.phone ? "أغلق المحادثة" : "راسله"}
                    </button>
                    <span dir="ltr">+{number}</span>
                    {entry.matchedArea?.trim() && entry.matchedArea !== entry.area.trim() ? (
                      <span>كتب: {entry.area}</span>
                    ) : null}
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => void markContacted(entry.phone, !entry.contactedAt)}
                    >
                      {entry.contactedAt ? "↩ ألغِ الوسم" : "✓ تواصلت معه"}
                    </button>
                    {entry.contactedAt ? <span>✅ {formatWhen(entry.contactedAt)}</span> : null}
                    {entry.addedByAdmin ? <span>إدخال يدوي</span> : null}
                  </div>

                  {openPhone === entry.phone ? (
                    <div className="demand-thread">
                      {thread === null ? (
                        <p className="amount-note">جار تحميل المحادثة...</p>
                      ) : thread.length === 0 ? (
                        <p className="amount-note">لا توجد محادثة محفوظة لهذا الرقم.</p>
                      ) : (
                        thread.map((line) => (
                          <div
                            className={line.direction === "inbound" ? "bubble inbound" : "bubble outbound"}
                            key={line.id}
                          >
                            <p>{line.body?.trim() || `(${line.message_type})`}</p>
                            <span>{formatWhen(line.created_at)}</span>
                          </div>
                        ))
                      )}

                      {/* Mounted for as long as the card is open, not only once the thread has
                          loaded: reloading after a send emptied it for a moment, and the box was
                          rebuilt from scratch -- taking the "أُرسلت" confirmation with it. */}
                      <ReplyBox
                        phone={entry.phone}
                        window={replyWindow}
                        handoverUntil={handoverUntil}
                        formatWhen={formatWhen}
                        onSent={() => loadThread(entry.phone)}
                        onHandoverEnd={() => loadThread(entry.phone)}
                      />
                    </div>
                  ) : null}
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
