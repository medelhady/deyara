"use client";

import { useEffect, useState } from "react";

type Entry = {
  id: string;
  phone: string;
  side: "owner" | "renter";
  area: string;
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

export function CollectionClient() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [byArea, setByArea] = useState<AreaDemand[]>([]);
  const [message, setMessage] = useState("جار التحميل...");
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

        <p>
          هذه ورقتك في اجتماع المكتب: «عندي {byArea[0]?.renters ?? 0} شخصًا يبحثون في{" "}
          {byArea[0]?.area ?? "المقاطعة"} اليوم» حديثٌ مختلف تمامًا عن طلب معروف.
        </p>

        {message ? <p>{message}</p> : null}

        {byArea.length > 0 ? (
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>المقاطعة</th>
                  <th>عروض المؤجرين</th>
                  <th>طلبات المستأجرين</th>
                </tr>
              </thead>
              <tbody>
                {byArea.map((row) => (
                  <tr key={row.area}>
                    <td>{row.area}</td>
                    <td>{row.owners}</td>
                    <td>{row.renters}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">إدخال يدوي</p>
            <h2>أضف من تعليقات فيسبوك وتيك توك</h2>
          </div>
        </div>

        <p>ما جمعته بيدك هو نفس الطلب — واتركه في التعليقات يعني إعادة قراءتها كل مرة.</p>

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
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">الكل</p>
            <h2>آخر ما وصل</h2>
          </div>
        </div>

        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>الجهة</th>
                <th>المقاطعة</th>
                <th>السعر</th>
                <th>المواصفات</th>
                <th>العمولة</th>
                <th>الرقم</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={6}>لا شيء بعد.</td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.side === "owner" ? "🏠 مؤجر" : "🔍 مستأجر"}</td>
                    <td>{entry.area}</td>
                    <td>{formatPrice(entry.price)}</td>
                    <td>{entry.specs ?? "—"}</td>
                    <td>{formatPrice(entry.commission)}</td>
                    <td dir="ltr">{entry.phone.replace("whatsapp:", "")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
