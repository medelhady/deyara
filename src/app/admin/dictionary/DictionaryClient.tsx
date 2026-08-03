"use client";

import { FormEvent, useEffect, useState } from "react";

type DictionaryEntry = {
  id: string;
  category: string;
  phrase: string;
  active: boolean;
  admin_note: string | null;
  created_at: string;
};

const categoryLabels: Record<string, string> = {
  greeting: "تحية",
  intro: "بداية محادثة",
  renter_search: "بحث مستأجر",
  owner_listing: "عرض مؤجر",
  area: "منطقة أو معلم"
};

export function DictionaryClient() {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [category, setCategory] = useState("renter_search");
  const [phrase, setPhrase] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadEntries() {
    setLoading(true);
    setError(null);
    const response = await fetch("/api/admin/dictionary", { cache: "no-store" });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "تعذر تحميل القاموس.");
      setLoading(false);
      return;
    }

    setEntries(data.entries ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadEntries();
  }, []);

  async function addEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const response = await fetch("/api/admin/dictionary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        category,
        phrase,
        admin_note: adminNote
      })
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "تعذر حفظ العبارة.");
      setSaving(false);
      return;
    }

    setPhrase("");
    setAdminNote("");
    setEntries((current) => [data.entry, ...current]);
    setSaving(false);
  }

  async function toggleEntry(entry: DictionaryEntry) {
    const response = await fetch(`/api/admin/dictionary/${entry.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        active: !entry.active
      })
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "تعذر تعديل العبارة.");
      return;
    }

    setEntries((current) => current.map((item) => (item.id === entry.id ? data.entry : item)));
  }

  async function deleteEntry(entry: DictionaryEntry) {
    const response = await fetch(`/api/admin/dictionary/${entry.id}`, {
      method: "DELETE"
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "تعذر حذف العبارة.");
      return;
    }

    setEntries((current) => current.filter((item) => item.id !== entry.id));
  }

  return (
    <section className="dictionary-layout">
      <form className="panel dictionary-form" onSubmit={addEntry}>
        <h2>إضافة عبارة جديدة</h2>
        <p>أضف الكلمات التي يستخدمها الناس في واتساب حتى يفهمها البوت مباشرة.</p>

        <label>
          نوع العبارة
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="renter_search">بحث مستأجر</option>
            <option value="owner_listing">عرض مؤجر</option>
            <option value="greeting">تحية</option>
            <option value="intro">بداية محادثة</option>
            <option value="area">منطقة أو معلم</option>
          </select>
        </label>

        <label>
          العبارة
          <input
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            placeholder="مثال: نلوج دار، دار فاضية، كرفور"
            required
          />
        </label>

        <label>
          ملاحظة داخلية
          <input
            value={adminNote}
            onChange={(event) => setAdminNote(event.target.value)}
            placeholder="اختياري"
          />
        </label>

        {error ? <p className="auth-error">{error}</p> : null}

        <button className="button" type="submit" disabled={saving}>
          {saving ? "جار الحفظ..." : "إضافة للقاموس"}
        </button>
      </form>

      <section className="panel dictionary-list">
        <h2>العبارات الحالية</h2>
        {loading ? <p>جار التحميل...</p> : null}
        {!loading && entries.length === 0 ? <p>لا توجد عبارات مضافة حتى الآن.</p> : null}

        {entries.map((entry) => (
          <article className="dictionary-row" key={entry.id}>
            <div>
              <strong>{entry.phrase}</strong>
              <span>{categoryLabels[entry.category] ?? entry.category}</span>
              {entry.admin_note ? <p>{entry.admin_note}</p> : null}
            </div>
            <div className="row-actions">
              <button type="button" onClick={() => toggleEntry(entry)}>
                {entry.active ? "تعطيل" : "تفعيل"}
              </button>
              <button type="button" onClick={() => deleteEntry(entry)}>
                حذف
              </button>
            </div>
          </article>
        ))}
      </section>
    </section>
  );
}
