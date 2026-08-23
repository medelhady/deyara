"use client";

import { useEffect, useState } from "react";

type Notification = {
  id: string;
  phone: string;
  kind: string;
  body: string | null;
  status: "sent" | "failed";
  error: string | null;
  explained: string | null;
  outsideWindow: boolean;
  created_at: string;
};

type Summary = { total: number; failed: number; outsideWindow: number };

const kindLabels: Record<string, string> = {
  admin_alert: "تنبيه للإدارة",
  listing_approved: "موافقة على إعلان",
  listing_rejected: "رفض إعلان",
  listing_submitted: "إرسال إعلان للمراجعة",
  topup_request: "طلب شحن رصيد",
  contact_released: "إرسال رقم المؤجر",
  referral_commission: "عمولة إحالة",
  referral_signup: "تسجيل عبر رابط دعوة",
  balance_credited: "إضافة رصيد",
  withdrawal_approved: "موافقة على سحب",
  withdrawal_rejected: "رفض سحب",
  withdrawal_paid: "تأكيد تحويل",
  property_rented: "إشعار تأجير الدار",
  bot_reply: "رد البوت",
  test: "رسالة اختبار"
};

function formatWhen(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("ar", { dateStyle: "short", timeStyle: "short" });
}

export function NotificationsClient() {
  const [rows, setRows] = useState<Notification[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [message, setMessage] = useState("جار تحميل السجل...");
  const [error, setError] = useState("");
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load(failedOnly: boolean) {
    const response = await fetch(`/api/admin/notifications?failed=${failedOnly ? "1" : "0"}&t=${Date.now()}`, {
      cache: "no-store"
    });
    const data = await response.json();

    if (!response.ok) {
      setMessage("");
      setError(data.error ?? "تعذر تحميل السجل.");
      return;
    }

    setError("");
    setRows(data.notifications ?? []);
    setSummary(data.summary ?? null);
    setMessage((data.notifications ?? []).length ? "" : "لا يوجد إشعارات مسجلة بعد.");
  }

  useEffect(() => {
    void load(onlyFailed);
  }, [onlyFailed]);

  return (
    <>
      {summary ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">آخر {summary.total} إشعار</p>
              <h2>
                {summary.failed === 0
                  ? "كلها وصلت ✅"
                  : `${summary.failed} لم تصل من أصل ${summary.total}`}
              </h2>
            </div>
            <button className="button secondary" type="button" onClick={() => setOnlyFailed(!onlyFailed)}>
              {onlyFailed ? "عرض الكل" : "الفاشلة فقط"}
            </button>
          </div>

          {summary.outsideWindow > 0 ? (
            <p className="auth-error">
              ⏰ {summary.outsideWindow} منها فشلت لأن نافذة الـ24 ساعة كانت مقفلة — واتساب يرفض
              الرسائل الحرة لمن لم يراسل البوت خلال يوم. الحل هو إرسالها عبر قالب معتمد من Meta.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="panel">
        {error ? <p className="auth-error">{error}</p> : null}
        {message ? <p>{message}</p> : null}

        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>الوقت</th>
                <th>الرقم</th>
                <th>النوع</th>
                <th>الحالة</th>
                <th>التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5}>لا يوجد سجل ضمن هذا الفلتر.</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatWhen(row.created_at)}</td>
                    <td dir="ltr">{row.phone.replace("whatsapp:", "")}</td>
                    <td>{kindLabels[row.kind] ?? row.kind}</td>
                    <td>
                      {row.status === "sent" ? "✅ وصلت" : row.outsideWindow ? "⏰ خارج النافذة" : "❌ فشلت"}
                    </td>
                    <td>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                      >
                        {expanded === row.id ? "إخفاء" : "عرض"}
                      </button>
                      {expanded === row.id ? (
                        <div className="notification-detail">
                          {row.explained ? <p className="auth-error">{row.explained}</p> : null}
                          <pre>{row.body}</pre>
                        </div>
                      ) : null}
                    </td>
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
