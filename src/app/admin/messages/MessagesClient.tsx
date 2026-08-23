"use client";

import { useEffect, useMemo, useState } from "react";

type Variable = { name: string; sample: string; note: string };

type MessageRow = {
  key: string;
  label: string;
  note: string;
  variables: Variable[];
  fallback: string;
  body: string;
  isCustom: boolean;
};

/** Mirrors renderMessage on the server so the preview shows what will actually be sent. */
function preview(template: string, variables: Variable[]) {
  const samples = new Map(variables.map((variable) => [variable.name, variable.sample]));

  return template
    .split("\n")
    .filter((line) => {
      const names = [...line.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]);
      return names.length === 0 || !names.every((name) => !(samples.get(name) ?? "").trim());
    })
    .map((line) => line.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, name: string) => samples.get(name) ?? ""))
    .join("\n");
}

function unknownIn(template: string, variables: Variable[]) {
  const allowed = new Set(variables.map((variable) => variable.name));
  const used = [...template.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]);

  return [...new Set(used)].filter((name) => !allowed.has(name));
}

export function MessagesClient() {
  const [rows, setRows] = useState<MessageRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("جار تحميل الرسائل...");
  const [error, setError] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  function seed(list: MessageRow[]) {
    setRows(list);
    setDrafts(Object.fromEntries(list.map((row) => [row.key, row.body || row.fallback])));
  }

  async function load() {
    const response = await fetch(`/api/admin/messages?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();

    if (!response.ok) {
      setMessage("");
      setError(data.error ?? "تعذر تحميل الرسائل.");
      return;
    }

    setMessage("");
    seed(data.messages ?? []);
  }

  async function save(row: MessageRow) {
    setSavingKey(row.key);
    setError("");
    setSavedKey(null);

    try {
      const response = await fetch("/api/admin/messages", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: row.key, body: drafts[row.key] ?? "" })
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "تعذر الحفظ.");
        return;
      }

      seed(data.messages ?? []);
      setSavedKey(row.key);
    } finally {
      setSavingKey(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const customCount = useMemo(() => rows.filter((row) => row.isCustom).length, [rows]);

  return (
    <>
      <section className="panel">
        <p>
          عدّل نص أي رسالة واحفظها — تسري خلال نصف دقيقة بدون إعادة نشر. المتغيرات تُكتب بين قوسين
          مثل <code>{"{code}"}</code>، ولا يُقبل الحفظ إن كتبت متغيرًا غير متاح للرسالة. لإرجاع النص
          الأصلي، امسح المحتوى واحفظ.
        </p>
        {customCount > 0 ? <p>✏️ {customCount} رسالة معدّلة عن النص الأصلي.</p> : null}
        {message ? <p>{message}</p> : null}
        {error ? <p className="auth-error">{error}</p> : null}
      </section>

      {rows.map((row) => {
        const draft = drafts[row.key] ?? "";
        const unknown = unknownIn(draft, row.variables);
        const changed = draft.trim() !== (row.body || row.fallback).trim();

        return (
          <section className="panel" key={row.key}>
            <div className="panel-header">
              <div>
                <p className="eyebrow">{row.isCustom ? "معدّلة" : "النص الأصلي"}</p>
                <h2>{row.label}</h2>
              </div>
            </div>

            <p>{row.note}</p>

            {row.variables.length > 0 ? (
              <div className="chips">
                {row.variables.map((variable) => (
                  <span key={variable.name} title={variable.note}>
                    {`{${variable.name}}`} — {variable.note}
                  </span>
                ))}
              </div>
            ) : (
              <p>هذه الرسالة بلا متغيرات.</p>
            )}

            <label>
              النص
              <textarea
                rows={Math.max(5, draft.split("\n").length + 1)}
                value={draft}
                onChange={(event) => setDrafts({ ...drafts, [row.key]: event.target.value })}
              />
            </label>

            {unknown.length > 0 ? (
              <p className="auth-error">
                متغيرات غير معروفة: {unknown.map((name) => `{${name}}`).join("، ")} — لن يُقبل الحفظ.
              </p>
            ) : null}

            <div className="message-preview">
              <span>المعاينة كما تصل المستخدم:</span>
              <pre>{preview(draft, row.variables)}</pre>
            </div>

            <div className="row-actions">
              <button
                className="button"
                type="button"
                disabled={savingKey === row.key || unknown.length > 0 || !changed}
                onClick={() => void save(row)}
              >
                {savingKey === row.key ? "جار الحفظ..." : "حفظ"}
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={savingKey === row.key}
                onClick={() => setDrafts({ ...drafts, [row.key]: row.fallback })}
              >
                استرجاع النص الأصلي
              </button>
              {savedKey === row.key ? <span>✅ حُفظت</span> : null}
            </div>
          </section>
        );
      })}
    </>
  );
}
