"use client";

import { useEffect, useState } from "react";
import { NoticesField } from "./NoticesField";

type SettingRow = {
  key: string;
  label: string;
  hint: string;
  kind: "number" | "text" | "textarea" | "notices";
  value: string;
};

export function SettingsClient() {
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("جار تحميل الإعدادات...");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [areas, setAreas] = useState<string[]>([]);

  async function loadSettings() {
    const response = await fetch(`/api/admin/settings?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    const loaded: SettingRow[] = data.settings ?? [];

    setRows(loaded);
    setAreas(data.areas ?? []);
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

  async function sendTestNotification() {
    setIsTesting(true);
    setMessage("جار إرسال تنبيه تجريبي...");

    try {
      const response = await fetch("/api/admin/settings/test-notify", { method: "POST" });
      const data = await response.json();

      if (!data.configured) {
        setMessage(`⚠️ ${data.message}`);
        return;
      }

      const lines = (data.results ?? []).map((result: { number: string; ok: boolean; error: string | null }) =>
        result.ok ? `✅ ${result.number}: وصلت` : `❌ ${result.number}: ${result.error}`
      );

      setMessage(lines.join("\n"));
    } finally {
      setIsTesting(false);
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

      {message ? <p style={{ whiteSpace: "pre-line" }}>{message}</p> : null}

      <div className="settings-grid">
        {rows.map((row) => (
          <label className="setting-field" key={row.key}>
            <span>{row.label}</span>
            {row.kind === "notices" ? (
              <NoticesField
                value={values[row.key] ?? ""}
                areas={areas}
                onChange={(next) => setValues((current) => ({ ...current, [row.key]: next }))}
              />
            ) : row.kind === "textarea" ? (
              <textarea
                rows={4}
                value={values[row.key] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [row.key]: event.target.value }))}
              />
            ) : (
              <input
                type={row.kind === "number" ? "number" : "text"}
                value={values[row.key] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [row.key]: event.target.value }))}
              />
            )}
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
        <button
          className="button secondary"
          type="button"
          onClick={() => void sendTestNotification()}
          disabled={isSaving || isTesting}
        >
          إرسال تنبيه تجريبي
        </button>
      </div>
    </section>
  );
}
