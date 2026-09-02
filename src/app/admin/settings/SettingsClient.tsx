"use client";

import { useEffect, useState } from "react";

type SettingRow = {
  key: string;
  label: string;
  hint: string;
  kind: "number" | "text" | "textarea";
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

  /**
   * Asks whether GPT is actually running the bot.
   *
   * It cannot be told from the outside: when the OpenAI call fails the engine falls back to keyword
   * matching and keeps answering, so nothing looks broken. The answer shows both readings of one
   * sentence side by side rather than asserting which one is live.
   */
  async function checkAi() {
    setIsTesting(true);
    setMessage("جار فحص فهم الجمل...");

    try {
      const response = await fetch("/api/admin/ai-health", { method: "POST" });
      const data = await response.json();

      if (!data.ok) {
        setMessage(`⚠️ ${data.message}`);
        return;
      }

      const field = (value: string | number | null) => (value === null ? "لم يفهمها" : String(value));

      setMessage(
        [
          `✅ ${data.message}`,
          "",
          `الجملة المختبَرة: ${data.probe}`,
          "",
          `بـGPT: المنطقة ${field(data.ai.area)} — الغرف ${field(data.ai.rooms)} — الحد الأقصى ${field(data.ai.maxPrice)}`,
          `بالكلمات المفتاحية وحدها: المنطقة ${field(data.local.area)} — الغرف ${field(data.local.rooms)} — الحد الأقصى ${field(data.local.maxPrice)}`
        ].join("\n")
      );
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
            {row.kind === "textarea" ? (
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
        <button
          className="button secondary"
          type="button"
          onClick={() => void checkAi()}
          disabled={isSaving || isTesting}
        >
          فحص فهم الجمل (GPT)
        </button>
      </div>
    </section>
  );
}
