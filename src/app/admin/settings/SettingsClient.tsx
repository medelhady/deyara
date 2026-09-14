"use client";

import { useEffect, useMemo, useState } from "react";
import { settingGroups, type SettingGroup } from "@/lib/setting-groups";

type SettingRow = {
  key: string;
  label: string;
  hint: string;
  kind: "number" | "text" | "textarea" | "toggle";
  group: SettingGroup;
  value: string;
};

/**
 * A switch, not a word to be typed.
 *
 * "on" and "off" in a text box are a setting nobody dares touch: there is no telling whether the
 * bot is running that way right now, and a typo -- "On", "yes", a trailing space -- reads as off
 * with no warning. Green means it is working, red means it is stopped, and the colour is the
 * answer to "which is it now" before anything is read.
 */
function Toggle({
  on,
  busy,
  onChange
}: {
  on: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={busy}
      className={on ? "switch is-on" : "switch is-off"}
      onClick={() => onChange(!on)}
    >
      <span className="switch-track">
        <span className="switch-knob" />
      </span>
      <span className="switch-label">{busy ? "..." : on ? "يعمل" : "متوقف"}</span>
    </button>
  );
}

export function SettingsClient() {
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("جار تحميل الإعدادات...");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  /**
   * What the switch itself did, said beside the switch.
   *
   * A refusal reported at the top of the page is a refusal nobody sees: the eye is on the control
   * that was just pressed, and a switch that silently snapped back reads as a broken button.
   */
  const [switchNote, setSwitchNote] = useState<{ key: string; kind: "ok" | "error"; text: string } | null>(null);

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

  /**
   * A switch saves itself, on its own.
   *
   * Anything else is a lie told by the control: a switch that has flipped but not taken effect
   * looks exactly like one that has, and the one thing these two switches decide is how the bot
   * answers every person who writes in the next minute. Only this key is sent, so a half-typed
   * price elsewhere on the page is not saved along with it.
   */
  async function flip(row: SettingRow, next: boolean) {
    const value = next ? "on" : "off";

    setSwitching(row.key);
    setMessage("");
    setSwitchNote(null);
    setValues((current) => ({ ...current, [row.key]: value }));

    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [row.key]: value })
      });
      const data = await response.json();

      if (!response.ok) {
        setValues((current) => ({ ...current, [row.key]: row.value }));
        setSwitchNote({ key: row.key, kind: "error", text: data.error ?? "تعذر حفظ الوضع." });
        return;
      }

      // The rows come back from the server so the switch shows what is stored, not what was clicked.
      const saved: SettingRow[] = data.settings ?? [];
      setRows(saved);
      setValues((current) => ({
        ...Object.fromEntries(saved.map((item) => [item.key, item.value])),
        // Anything else the admin was in the middle of typing stays as they left it.
        ...Object.fromEntries(Object.entries(current).filter(([key]) => key !== row.key))
      }));
      setSwitchNote({
        key: row.key,
        kind: "ok",
        text: next ? "✅ يعمل الآن — حُفِظ فورًا." : "✅ متوقف الآن — حُفِظ فورًا."
      });
    } finally {
      setSwitching(null);
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

  /**
   * What has been changed and not yet saved.
   *
   * The page has one save button for fourteen fields, so without this an admin cannot tell an edit
   * that is stored from one that is still sitting in the box -- and they leave believing a price
   * changed when it did not.
   */
  const changed = useMemo(
    () => rows.filter((row) => (values[row.key] ?? "") !== row.value).map((row) => row.key),
    [rows, values]
  );

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">الإعدادات</p>
            <h2>ما يعمل به البوت الآن</h2>
          </div>
        </div>

        <p>هذه القيم يقرأها البوت مباشرة. أي تعديل هنا يسري على المحادثات الجارية دون إعادة نشر.</p>

        {message ? <p style={{ whiteSpace: "pre-line" }}>{message}</p> : null}
      </section>

      {settingGroups.map((group) => {
        const inGroup = rows.filter((row) => row.group === group.key);

        if (inGroup.length === 0) {
          return null;
        }

        return (
          <section className="panel" key={group.key}>
            <div className="panel-header">
              <div>
                <p className="eyebrow">{group.title}</p>
                <h2>{group.note}</h2>
              </div>
            </div>

            {/* Switches get a row each: they are read at a glance, and a colour squeezed into a
                two-column grid is a colour nobody notices. */}
            {inGroup.some((row) => row.kind === "toggle") ? (
              <div className="switch-list">
                {inGroup
                  .filter((row) => row.kind === "toggle")
                  .map((row) => (
                    <div className="switch-row" key={row.key}>
                      <div className="switch-text">
                        <strong>{row.label}</strong>
                        <small>{row.hint}</small>
                        {switchNote?.key === row.key ? (
                          <small className={switchNote.kind === "ok" ? "switch-ok" : "switch-error"}>
                            {switchNote.text}
                          </small>
                        ) : null}
                      </div>
                      <Toggle
                        on={(values[row.key] ?? "").trim().toLowerCase() === "on"}
                        busy={switching === row.key}
                        onChange={(next) => void flip(row, next)}
                      />
                    </div>
                  ))}
              </div>
            ) : null}

            {inGroup.some((row) => row.kind !== "toggle") ? (
              <div className="settings-grid">
                {inGroup
                  .filter((row) => row.kind !== "toggle")
                  .map((row) => (
                    <label
                      className={changed.includes(row.key) ? "setting-field is-dirty" : "setting-field"}
                      key={row.key}
                    >
                      <span>
                        {row.label}
                        {changed.includes(row.key) ? <em className="setting-dirty">غير محفوظ</em> : null}
                      </span>
                      {row.kind === "textarea" ? (
                        <textarea
                          rows={4}
                          value={values[row.key] ?? ""}
                          onChange={(event) =>
                            setValues((current) => ({ ...current, [row.key]: event.target.value }))
                          }
                        />
                      ) : (
                        <input
                          type={row.kind === "number" ? "number" : "text"}
                          inputMode={row.kind === "number" ? "numeric" : undefined}
                          value={values[row.key] ?? ""}
                          onChange={(event) =>
                            setValues((current) => ({ ...current, [row.key]: event.target.value }))
                          }
                        />
                      )}
                      <small>{row.hint}</small>
                    </label>
                  ))}
              </div>
            ) : null}
          </section>
        );
      })}

      <section className="panel">
        <div className="quick-actions">
          <button
            className="button"
            type="button"
            onClick={() => void save()}
            disabled={isSaving || changed.length === 0}
          >
            {isSaving
              ? "جار الحفظ..."
              : changed.length > 0
                ? `حفظ ${changed.length} تعديل`
                : "لا تعديلات للحفظ"}
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => void loadSettings()}
            disabled={isSaving || changed.length === 0}
          >
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
    </>
  );
}
