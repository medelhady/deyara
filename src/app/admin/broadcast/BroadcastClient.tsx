"use client";

import { useEffect, useState } from "react";

type Audience = "all" | "renter" | "owner" | "marketer";

const audiences: Array<{ key: Audience; label: string }> = [
  { key: "all", label: "الجميع" },
  { key: "renter", label: "المستأجرون" },
  { key: "owner", label: "المؤجرون" },
  { key: "marketer", label: "المسوّقون" }
];

type Counts = { total: number; reachable: number; unreachable: number };

export function BroadcastClient() {
  const [audience, setAudience] = useState<Audience>("all");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; processed: number; total: number } | null>(null);
  const [failures, setFailures] = useState<Array<{ phone: string; error: string }>>([]);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function loadCounts(next: Audience) {
    setCounts(null);
    const response = await fetch(`/api/admin/broadcast?audience=${next}&t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "تعذر حساب عدد المستلمين.");
      return;
    }

    setError("");
    setCounts({ total: data.total, reachable: data.reachable, unreachable: data.unreachable });
  }

  useEffect(() => {
    void loadCounts(audience);
  }, [audience]);

  async function send() {
    if (!counts || counts.reachable === 0) {
      return;
    }

    const confirmed = window.confirm(
      `إرسال هذه الرسالة إلى ${counts.reachable} شخصًا؟\n\n` +
        "لا يمكن التراجع بعد الإرسال، ولا يمكن حذف رسالة وصلت."
    );

    if (!confirmed) {
      return;
    }

    setSending(true);
    setFailures([]);
    setDone(false);
    setError("");
    setProgress({ sent: 0, processed: 0, total: counts.reachable });

    try {
      let offset = 0;
      let sent = 0;
      const collected: Array<{ phone: string; error: string }> = [];

      // Sent in batches: one request per batch keeps each call inside the function timeout, and the
      // progress it returns is what tells an admin where a long send has got to.
      for (;;) {
        const response = await fetch("/api/admin/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audience, body: text, offset })
        });
        const data = await response.json();

        if (!response.ok) {
          setError(data.error ?? "تعذر الإرسال.");
          return;
        }

        sent += data.sent;
        collected.push(...(data.failures ?? []));
        offset = data.processed;

        setProgress({ sent, processed: offset, total: data.total });
        setFailures([...collected]);

        if (data.done || data.processed === 0) {
          setDone(true);
          return;
        }
      }
    } finally {
      setSending(false);
      void loadCounts(audience);
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">من يستلم</p>
            <h2>اختر الفئة</h2>
          </div>
        </div>

        <div className="filters-bar">
          {audiences.map((item) => (
            <button
              key={item.key}
              type="button"
              className={audience === item.key ? "active" : undefined}
              disabled={sending}
              onClick={() => setAudience(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {counts ? (
          <>
            <p>
              في هذه الفئة <strong>{counts.total}</strong> مستخدمًا، منهم{" "}
              <strong>{counts.reachable}</strong> يمكن الوصول إليهم الآن.
            </p>

            {counts.unreachable > 0 ? (
              <p className="auth-error">
                ⏰ {counts.unreachable} منهم لم يراسلوا البوت خلال 24 ساعة، وواتساب يرفض الرسائل
                الحرة إليهم. لن نحاول إرسالها لهم: المحاولة تفشل وتخصم من حد الإرسال اليومي وتخفض
                تقييم رقمك. الوصول إليهم يحتاج قالبًا بتصنيف Marketing وموافقتهم على استقباله.
              </p>
            ) : null}
          </>
        ) : (
          <p>جار حساب عدد المستلمين...</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">النص</p>
            <h2>ما الذي سيصلهم</h2>
          </div>
        </div>

        <label>
          نص الرسالة
          <textarea
            rows={6}
            value={text}
            disabled={sending}
            placeholder="اكتب الرسالة كما ستصل المستخدم تمامًا..."
            onChange={(event) => setText(event.target.value)}
          />
        </label>

        {error ? <p className="auth-error">{error}</p> : null}

        <div className="row-actions">
          <button
            className="button"
            type="button"
            disabled={sending || text.trim().length < 2 || !counts || counts.reachable === 0}
            onClick={() => void send()}
          >
            {sending ? "جارٍ الإرسال..." : `إرسال إلى ${counts?.reachable ?? 0}`}
          </button>
        </div>

        {progress ? (
          <p>
            {done ? "✅ انتهى الإرسال — " : "جارٍ الإرسال — "}
            وصلت <strong>{progress.sent}</strong> من <strong>{progress.total}</strong>
            {failures.length > 0 ? ` (${failures.length} فشلت)` : ""}
          </p>
        ) : null}

        {failures.length > 0 ? (
          <div className="delete-report">
            {failures.slice(0, 20).map((failure) => (
              <p key={failure.phone}>
                ⚠️ <span dir="ltr">{failure.phone.replace("whatsapp:", "")}</span> — {failure.error}
              </p>
            ))}
            {failures.length > 20 ? <p>...و{failures.length - 20} أخرى في سجل الإشعارات.</p> : null}
          </div>
        ) : null}
      </section>
    </>
  );
}
