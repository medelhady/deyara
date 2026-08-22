"use client";

import { useEffect, useState } from "react";

type Account = {
  id: string;
  phone: string;
  name: string;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  last_login_at: string | null;
};

const minimumPasswordLength = 8;

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("ar", { dateStyle: "medium" });
}

export function AccountsClient() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [message, setMessage] = useState("جار تحميل الحسابات...");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ phone: "", name: "", password: "" });

  async function loadAccounts() {
    const response = await fetch(`/api/admin/accounts?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();

    if (!response.ok) {
      setMessage("");
      setError(data.error ?? "تعذر تحميل الحسابات.");
      return;
    }

    setError("");
    setAccounts(data.accounts ?? []);
    setMessage((data.accounts ?? []).length ? "" : "لا يوجد حساب دخول بعد.");
  }

  async function addAccount(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "تعذر إضافة الحساب.");
        return;
      }

      setForm({ phone: "", name: "", password: "" });
      await loadAccounts();
    } finally {
      setSaving(false);
    }
  }

  async function patchAccount(account: Account, body: Record<string, unknown>, failure: string) {
    setBusyId(account.id);
    setError("");

    try {
      const response = await fetch(`/api/admin/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? failure);
        return false;
      }

      await loadAccounts();
      return true;
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(account: Account) {
    const password = window.prompt(`رقم سري جديد لـ ${account.phone} (${minimumPasswordLength} خانات فأكثر):`);

    if (password === null) {
      return;
    }

    if (password.length < minimumPasswordLength) {
      setError(`الرقم السري لا يقل عن ${minimumPasswordLength} خانات.`);
      return;
    }

    if (await patchAccount(account, { password }, "تعذر تغيير الرقم السري.")) {
      setMessage(`تم تغيير الرقم السري لـ ${account.phone}.`);
    }
  }

  async function removeAccount(account: Account) {
    if (!window.confirm(`حذف حساب ${account.phone} نهائيًا؟`)) {
      return;
    }

    setBusyId(account.id);
    setError("");

    try {
      const response = await fetch(`/api/admin/accounts/${account.id}`, { method: "DELETE" });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "تعذر حذف الحساب.");
        return;
      }

      await loadAccounts();
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    void loadAccounts();
  }, []);

  const activeCount = accounts.filter((account) => account.is_active).length;

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">إضافة حساب</p>
            <h2>من يدخل اللوحة</h2>
          </div>
        </div>

        <p>
          كل شخص يدخل برقمه ورقمه السري. الرقم السري يُخزَّن مشفّرًا ولا يمكن استرجاعه — لو نُسي، أعد
          تعيينه من الجدول.
        </p>

        <form className="auth-form" onSubmit={addAccount}>
          <label>
            رقم الهاتف
            <input
              type="tel"
              inputMode="tel"
              dir="ltr"
              placeholder="22245678901"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              required
            />
          </label>
          <label>
            الاسم
            <input
              type="text"
              placeholder="اسم الموظف"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label>
            الرقم السري
            <input
              type="password"
              autoComplete="new-password"
              minLength={minimumPasswordLength}
              placeholder={`${minimumPasswordLength} خانات فأكثر`}
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              required
            />
          </label>
          <button className="button" type="submit" disabled={saving}>
            {saving ? "جار الإضافة..." : "إضافة الحساب"}
          </button>
        </form>

        {error ? <p className="auth-error">{error}</p> : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">الحسابات</p>
            <h2>
              {accounts.length} حساب{activeCount !== accounts.length ? ` — ${activeCount} فعّال` : ""}
            </h2>
          </div>
          <form action="/api/admin/logout" method="post">
            <button className="button secondary" type="submit">
              تسجيل الخروج
            </button>
          </form>
        </div>

        {message ? <p>{message}</p> : null}

        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>الرقم</th>
                <th>الاسم</th>
                <th>الحالة</th>
                <th>أضافه</th>
                <th>آخر دخول</th>
                <th>الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={6}>لا يوجد حساب بعد.</td>
                </tr>
              ) : (
                accounts.map((account) => (
                  <tr key={account.id}>
                    <td dir="ltr">{account.phone}</td>
                    <td>{account.name || "—"}</td>
                    <td>{account.is_active ? "✅ فعّال" : "⛔ موقوف"}</td>
                    <td dir="ltr">{account.created_by || "—"}</td>
                    <td>{formatDate(account.last_login_at)}</td>
                    <td className="row-actions">
                      <button
                        className="button secondary"
                        type="button"
                        disabled={busyId === account.id}
                        onClick={() =>
                          void patchAccount(
                            account,
                            { isActive: !account.is_active },
                            "تعذر تحديث حالة الحساب."
                          )
                        }
                      >
                        {account.is_active ? "إيقاف" : "تفعيل"}
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        disabled={busyId === account.id}
                        onClick={() => void resetPassword(account)}
                      >
                        رقم سري جديد
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        disabled={busyId === account.id}
                        onClick={() => void removeAccount(account)}
                      >
                        حذف
                      </button>
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
