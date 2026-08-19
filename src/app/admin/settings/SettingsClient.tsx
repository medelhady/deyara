"use client";

import { useEffect, useState } from "react";

type SettingRow = {
  key: string;
  label: string;
  hint: string;
  kind: "number" | "text";
  value: string;
};

export function SettingsClient() {
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("جار تحميل الإعدادات...");
  const [isSaving, setIsSaving] = useState(false);

  async function loadSettings() {
    const response = await fetch(`/api/admin/settings?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    const loaded: SettingRow[] = data.settings ?? [];

    setRows(loaded);
    setValues(Object.fromEntries(loaded.map((row) => [row.key, row.value])));
    setMessage(data.warning ? `⚠️ ${data.warning}` : "");
  }

  async function save() {
    setIsSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values)
      });
      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error ?? "تعذر حفظ الإعدادات.");
        return;
      }

      const saved: SettingRow[] = data.settings ?? [];
      setRows(saved);
      setValues(Object.fromEntries(saved.map((row) => [row.key, row.value])));
      setMessage("✅ تم الحفظ. القيم الجديدة تسري خلال أقل من دقيقة.");
    } finally {
      setIsSaving(false);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">الإعدادات</p>
          <h2>الأسعار وأرقام الدفع</h2>
        </div>
      </div>

      <p>
        هذه القيم يقرأها البوت مباشرة. أي تعديل هنا يسري على المحادثات الجارية دون إعادة نشر.
      </p>

      {message ? <p>{message}</p> : null}

      <div className="settings-grid">
        {rows.map((row) => (
          <label className="setting-field" key={row.key}>
            <span>{row.label}</span>
            <input
              type={row.kind === "number" ? "number" : "text"}
              value={values[row.key] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [row.key]: event.target.value }))}
            />
            <small>{row.hint}</small>
          </label>
        ))}
      </div>

      <div className="quick-actions">
        <button className="button" type="button" onClick={() => void save()} disabled={isSaving || rows.length === 0}>
          {isSaving ? "جار الحفظ..." : "حفظ الإعدادات"}
        </button>
        <button className="button secondary" type="button" onClick={() => void loadSettings()} disabled={isSaving}>
          تراجع عن التعديلات
        </button>
      </div>
    </section>
  );
}
