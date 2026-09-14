"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { officePlatforms } from "@/lib/office-platforms";

type Office = {
  id: string;
  name: string;
  phones: string[];
  platform: string | null;
  note: string | null;
  screenshotPath: string | null;
  createdAt: string;
};

type Draft = {
  key: string;
  fileName: string;
  path: string | null;
  name: string;
  phones: string;
  platform: string;
  note: string;
  status: "reading" | "ready" | "failed" | "saved";
  error?: string;
};

function formatWhen(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ar", { dateStyle: "short", timeStyle: "short" });
}

/**
 * The agencies, read off screenshots.
 *
 * They are not on the bot and will not be for a while: they are a name and a number inside a
 * Facebook or TikTok post. Typing those out is the work that never gets done, so the screenshot is
 * the input.
 *
 * Every reading is shown for correction before it is saved. A language model reading a photograph
 * gets a digit wrong now and then, and a wrong digit is a row that looks right and reaches nobody --
 * so the page is built around checking, not around trusting.
 */
export function OfficesClient() {
  const [offices, setOffices] = useState<Office[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [message, setMessage] = useState("جار التحميل...");
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [search, setSearch] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    const response = await fetch(`/api/admin/offices?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();

    setOffices(data.offices ?? []);
    setMessage(data.error ?? ((data.offices ?? []).length ? "" : "لا توجد مكاتب بعد. ارفع أول لقطة."));
  }

  useEffect(() => {
    void load();
  }, []);

  function patch(key: string, changes: Partial<Draft>) {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...changes } : draft)));
  }

  /**
   * One screenshot: uploaded straight to storage, then read where the key lives.
   *
   * Several at once are handled one after another rather than together -- the reader is the slow
   * part, and ten parallel requests is how a rate limit turns a batch into ten failures.
   */
  async function readOne(file: File, key: string) {
    try {
      const slotResponse = await fetch("/api/admin/offices/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type, name: file.name })
      });
      const slot = await slotResponse.json();

      if (!slotResponse.ok) {
        patch(key, { status: "failed", error: slot.error ?? "تعذر الرفع." });
        return;
      }

      const upload = await fetch(slot.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });

      if (!upload.ok) {
        const detail = (await upload.text().catch(() => "")).slice(0, 150);

        patch(key, { status: "failed", error: `تعذر رفع الصورة (${upload.status}). ${detail}` });
        return;
      }

      const readResponse = await fetch("/api/admin/offices/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "read", path: slot.path })
      });
      const read = await readResponse.json();

      if (!readResponse.ok) {
        patch(key, { status: "failed", path: slot.path, error: read.error ?? "تعذرت قراءة الصورة." });
        return;
      }

      patch(key, {
        status: "ready",
        path: slot.path,
        name: read.draft.name ?? "",
        phones: (read.draft.phones ?? []).join("، "),
        platform: read.draft.platform ?? "",
        note: read.draft.note ?? ""
      });
    } catch (error) {
      patch(key, { status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function handleFiles(files: File[]) {
    setNote(null);

    const queued: Draft[] = files.map((file, index) => ({
      key: `${Date.now()}-${index}-${file.name}`,
      fileName: file.name,
      path: null,
      name: "",
      phones: "",
      platform: "",
      note: "",
      status: "reading"
    }));

    setDrafts((current) => [...queued, ...current]);

    for (const [index, file] of files.entries()) {
      await readOne(file, queued[index].key);
    }

    if (fileInput.current) {
      fileInput.current.value = "";
    }
  }

  async function saveDraft(draft: Draft) {
    const response = await fetch("/api/admin/offices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        phones: draft.phones.split(/[,،\n/]/),
        platform: draft.platform,
        note: draft.note,
        screenshotPath: draft.path
      })
    });
    const data = await response.json();

    if (!response.ok) {
      patch(draft.key, { error: data.error ?? "تعذر الحفظ." });
      return;
    }

    setDrafts((current) => current.filter((item) => item.key !== draft.key));
    await load();
    setNote({ kind: "ok", text: `✅ حُفظ «${draft.name.trim()}».` });
  }

  async function remove(office: Office) {
    if (!window.confirm(`حذف «${office.name}» من القائمة؟`)) {
      return;
    }

    const response = await fetch(`/api/admin/offices/${office.id}`, { method: "DELETE" });
    const data = await response.json();

    await load();

    if (!response.ok) {
      setNote({ kind: "error", text: data.error ?? "تعذر الحذف." });
    }
  }

  /**
   * Numbers already in the list, so the same office is not collected twice.
   *
   * The same post is screenshotted twice over a week of scrolling, and a list with the same office
   * three times is a list nobody trusts to call from.
   */
  const known = useMemo(() => {
    const map = new Map<string, string>();

    for (const office of offices) {
      for (const phone of office.phones) {
        map.set(phone, office.name);
      }
    }

    return map;
  }, [offices]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");

    if (!term) {
      return offices;
    }

    return offices.filter(
      (office) =>
        office.name.toLowerCase().includes(term) ||
        (office.platform ?? "").toLowerCase().includes(term) ||
        (digits && office.phones.some((phone) => phone.includes(digits)))
    );
  }, [offices, search]);

  return (
    <>
      <section className="panel">
        <p>
          ارفع لقطة شاشة لمنشور أو صفحة مكتب عقاري، ويقرأ منها النظام الاسم وأرقام التواصل والمنصة.
          تراجع ما قرأه وتصحّحه قبل الحفظ — القراءة الآلية تخطئ رقمًا أحيانًا، والرقم الخاطئ صفٌّ
          يبدو سليمًا ولا يصل أحدًا.
        </p>
        {note ? <p className={note.kind === "ok" ? "reply-ok" : "auth-error"}>{note.text}</p> : null}

        <div className="row-actions campaign-video">
          <strong>لقطات الشاشة</strong>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/*"
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);

              if (files.length > 0) {
                void handleFiles(files);
              }
            }}
          />
          <span className="amount-note">تقدر تختار أكثر من صورة مرة واحدة، وتُقرأ واحدة بعد الأخرى.</span>
        </div>
      </section>

      {drafts.length > 0 ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">بانتظار مراجعتك</p>
              <h2>{drafts.length} لقطة</h2>
            </div>
          </div>

          <div className="demand-list">
            {drafts.map((draft) => {
              const duplicates = draft.phones
                .split(/[,،\n/]/)
                .map((phone) => phone.replace(/\D/g, ""))
                .map((phone) => (phone.length === 8 ? `222${phone}` : phone))
                .filter((phone) => known.has(phone));

              return (
                <article className="demand-row" key={draft.key}>
                  <div className="demand-row-head">
                    <span className="demand-tag">{draft.fileName}</span>
                    {draft.status === "reading" ? <span className="amount-note">جارٍ القراءة...</span> : null}
                    {draft.status === "failed" ? <span className="auth-error">{draft.error}</span> : null}
                  </div>

                  {draft.status !== "reading" ? (
                    <>
                      <div className="settings-grid">
                        <label className="setting-field">
                          <span>اسم المكتب</span>
                          <input value={draft.name} onChange={(event) => patch(draft.key, { name: event.target.value })} />
                        </label>
                        <label className="setting-field">
                          <span>أرقام التواصل</span>
                          <input
                            inputMode="numeric"
                            value={draft.phones}
                            onChange={(event) => patch(draft.key, { phones: event.target.value })}
                          />
                          <small>افصل بينها بفاصلة. الرقم من 8 أرقام يُحفظ بمقدمة 222.</small>
                        </label>
                        <label className="setting-field">
                          <span>المنصة</span>
                          <select
                            value={draft.platform}
                            onChange={(event) => patch(draft.key, { platform: event.target.value })}
                          >
                            <option value="">— اختر —</option>
                            {officePlatforms.map((platform) => (
                              <option key={platform} value={platform}>
                                {platform}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="setting-field">
                          <span>ملاحظة</span>
                          <input value={draft.note} onChange={(event) => patch(draft.key, { note: event.target.value })} />
                        </label>
                      </div>

                      {duplicates.length > 0 ? (
                        <p className="amount-note">
                          ⚠️ {duplicates.map((phone) => `${phone} مسجّل في «${known.get(phone)}»`).join("، ")}
                        </p>
                      ) : null}

                      {draft.error ? <p className="auth-error">{draft.error}</p> : null}

                      <div className="demand-row-foot">
                        <button className="button" type="button" onClick={() => void saveDraft(draft)}>
                          احفظ في القائمة
                        </button>
                        <button
                          className="button secondary"
                          type="button"
                          onClick={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))}
                        >
                          تجاهل
                        </button>
                      </div>
                    </>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">المكاتب</p>
            <h2>{offices.length} مكتبًا</h2>
          </div>
          <a className="button secondary" href="/api/admin/offices/csv">
            ⬇ تصدير إكسل
          </a>
        </div>

        <input
          type="search"
          placeholder="ابحث بالاسم أو الرقم أو المنصة"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        {message ? <p>{message}</p> : null}

        {visible.length > 0 ? (
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>المكتب</th>
                  <th>أرقام التواصل</th>
                  <th>المنصة</th>
                  <th>أُضيف</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((office) => (
                  <tr key={office.id}>
                    <td>
                      <strong>{office.name}</strong>
                      {office.note ? <small className="office-note">{office.note}</small> : null}
                    </td>
                    <td>
                      <div className="office-phones">
                        {office.phones.map((phone) => (
                          // Straight to WhatsApp: the number is only useful as the call it becomes.
                          <a key={phone} href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer" dir="ltr">
                            +{phone}
                          </a>
                        ))}
                      </div>
                    </td>
                    <td>{office.platform ?? "—"}</td>
                    <td>{formatWhen(office.createdAt)}</td>
                    <td>
                      <button className="button secondary" type="button" onClick={() => void remove(office)}>
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}
