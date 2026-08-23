"use client";

import { useEffect, useMemo, useState } from "react";

type AdminUser = {
  phone: string;
  role: string | null;
  created_at: string;
  blocked_at: string | null;
  blocked_reason: string | null;
  listings_count: number;
  contact_requests_count: number;
};

const roleLabels: Record<string, string> = {
  owner: "مؤجر",
  renter: "مستأجر",
  admin: "إدارة"
};

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("ar", { dateStyle: "medium" });
}

export function UsersClient() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [message, setMessage] = useState("جار تحميل المستخدمين...");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "owner" | "renter" | "blocked">("all");
  const [busyPhone, setBusyPhone] = useState<string | null>(null);
  const [credit, setCredit] = useState({ phone: "", points: "", note: "" });
  const [crediting, setCrediting] = useState(false);
  const [creditError, setCreditError] = useState("");
  const [creditDone, setCreditDone] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [deleteReport, setDeleteReport] = useState<Array<{ phone: string; deleted: boolean; reason?: string }>>([]);

  async function loadUsers() {
    const response = await fetch(`/api/admin/users?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();

    if (data.mode === "mock") {
      setMessage("Supabase غير مربوط بعد. بعد إضافة المفاتيح سيظهر المستخدمون هنا.");
      return;
    }

    if (!response.ok) {
      setMessage(data.error ?? "تعذر تحميل المستخدمين.");
      return;
    }

    setUsers(data.users ?? []);
    setMessage((data.users ?? []).length ? "" : "لا يوجد مستخدمون بعد.");
  }

  async function toggleBlock(user: AdminUser) {
    const blocking = !user.blocked_at;
    const reason = blocking ? window.prompt("سبب الإيقاف (اختياري):") ?? "" : "";

    setBusyPhone(user.phone);

    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.phone)}/block`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocked: blocking, reason })
      });
      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error ?? "تعذر تحديث حالة المستخدم.");
        return;
      }

      setMessage("");
      await loadUsers();
    } finally {
      setBusyPhone(null);
    }
  }

  async function addCredit(event: React.FormEvent) {
    event.preventDefault();
    setCrediting(true);
    setCreditError("");
    setCreditDone("");

    try {
      const response = await fetch("/api/admin/users/credit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...credit, points: Number(credit.points) })
      });
      const data = await response.json();

      if (!response.ok) {
        setCreditError(data.error ?? "تعذر إضافة الرصيد.");
        return;
      }

      setCreditDone(
        data.releasedContact
          ? `${data.message} وأرسلنا له رقم المؤجر الذي كان ينتظره.`
          : String(data.message ?? "تمت الإضافة.")
      );
      setCredit({ phone: "", points: "", note: "" });
      await loadUsers();
    } finally {
      setCrediting(false);
    }
  }

  function toggle(phone: string) {
    setSelected((current) =>
      current.includes(phone) ? current.filter((item) => item !== phone) : [...current, phone]
    );
  }

  async function deleteSelected() {
    // Spelled out rather than a bare "are you sure": what goes with the row is the part that cannot
    // be undone, and it is not obvious from a list of phone numbers.
    const confirmed = window.confirm(
      `حذف ${selected.length} مستخدم نهائيًا؟\n\n` +
        "يُحذف معهم رصيدهم وسجل حركاتهم المالية ومحادثاتهم، ولا يمكن استرجاعها.\n" +
        "من له إعلانات أو طلبات تواصل أو رصيد سيُتخطى مع بيان السبب."
    );

    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setMessage("");
    setDeleteReport([]);

    try {
      const response = await fetch("/api/admin/users/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phones: selected })
      });
      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error ?? "تعذر الحذف.");
        return;
      }

      setDeleteReport(data.results ?? []);
      setSelected([]);
      await loadUsers();
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  const visibleUsers = useMemo(() => {
    const term = search.replace(/\s/g, "");

    return users.filter((user) => {
      if (term && !user.phone.replace(/\s/g, "").includes(term)) {
        return false;
      }

      if (filter === "blocked") {
        return Boolean(user.blocked_at);
      }

      if (filter === "all") {
        return true;
      }

      return user.role === filter;
    });
  }, [users, search, filter]);

  const blockedCount = users.filter((user) => user.blocked_at).length;

  return (
    <>
    {/* Folded away: the list is what this page is opened for, and crediting is occasional. */}
    <details className="panel dash-details">
      <summary>➕ تسجيل مستخدم وشحن رصيده</summary>

      <p>
        اكتب الرقم بصيغة دولية كاملة. لو لم يكن مسجلًا بعد، يُسجَّل الآن. تصل المستخدم رسالة واتساب
        بالرصيد الجديد، ولو كان ينتظر رقم مؤجر يُرسل له فورًا.
      </p>

      <form className="auth-form" onSubmit={addCredit}>
        <label>
          رقم الهاتف
          <input
            type="tel"
            inputMode="tel"
            dir="ltr"
            placeholder="22245678901"
            value={credit.phone}
            onChange={(event) => setCredit({ ...credit, phone: event.target.value })}
            required
          />
        </label>
        <label>
          عدد النقاط
          <input
            type="number"
            min={1}
            step={1}
            dir="ltr"
            placeholder="2000"
            value={credit.points}
            onChange={(event) => setCredit({ ...credit, points: event.target.value })}
            required
          />
        </label>
        <label>
          سبب الإضافة (اختياري)
          <input
            type="text"
            placeholder="تعويض، هدية ترويجية، تصحيح رصيد..."
            value={credit.note}
            onChange={(event) => setCredit({ ...credit, note: event.target.value })}
          />
        </label>
        <button className="button" type="submit" disabled={crediting}>
          {crediting ? "جار الإضافة..." : "إضافة الرصيد"}
        </button>
      </form>

      {creditError ? <p className="auth-error">{creditError}</p> : null}
      {creditDone ? <p>✅ {creditDone}</p> : null}
    </details>

    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">المستخدمون</p>
          <h2>
            {users.length} مسجل{blockedCount > 0 ? ` — ${blockedCount} موقوف` : ""}
          </h2>
        </div>
        <input
          type="search"
          placeholder="ابحث برقم الهاتف"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="filters-bar">
        {(["all", "owner", "renter", "blocked"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={filter === value ? "active" : undefined}
            onClick={() => setFilter(value)}
          >
            {value === "all" ? "الكل" : value === "blocked" ? "الموقوفون" : roleLabels[value]}
          </button>
        ))}
      </div>

      {selected.length > 0 ? (
        <div className="bulk-bar">
          <span>{selected.length} محدد</span>
          <button className="button" type="button" disabled={deleting} onClick={() => void deleteSelected()}>
            {deleting ? "جار الحذف..." : "حذف المحدد"}
          </button>
          <button className="button secondary" type="button" onClick={() => setSelected([])}>
            إلغاء التحديد
          </button>
        </div>
      ) : null}

      {deleteReport.length > 0 ? (
        <div className="delete-report">
          {deleteReport.map((result) => (
            <p key={result.phone}>
              {result.deleted ? "🗑" : "⚠️"} <span dir="ltr">{result.phone.replace("whatsapp:", "")}</span>{" "}
              {result.deleted ? "— حُذف" : `— لم يُحذف: ${result.reason}`}
            </p>
          ))}
        </div>
      ) : null}

      {message ? <p>{message}</p> : null}

      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th className="select-cell">
                <input
                  type="checkbox"
                  aria-label="تحديد الكل"
                  checked={visibleUsers.length > 0 && visibleUsers.every((user) => selected.includes(user.phone))}
                  onChange={(event) =>
                    setSelected(event.target.checked ? visibleUsers.map((user) => user.phone) : [])
                  }
                />
              </th>
              <th>الرقم</th>
              <th>الدور</th>
              <th>تاريخ التسجيل</th>
              <th>الإعلانات</th>
              <th>طلبات التواصل</th>
              <th>الحالة</th>
              <th>الإجراء</th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.length === 0 ? (
              <tr>
                <td colSpan={8}>لا يوجد مستخدمون ضمن هذا الفلتر.</td>
              </tr>
            ) : (
              visibleUsers.map((user) => (
                <tr key={user.phone} className={selected.includes(user.phone) ? "is-selected" : undefined}>
                  <td className="select-cell">
                    <input
                      type="checkbox"
                      aria-label={`تحديد ${user.phone}`}
                      checked={selected.includes(user.phone)}
                      onChange={() => toggle(user.phone)}
                    />
                  </td>
                  <td>{user.phone}</td>
                  <td>{roleLabels[user.role ?? ""] ?? user.role ?? "—"}</td>
                  <td>{formatDate(user.created_at)}</td>
                  <td>{user.listings_count}</td>
                  <td>{user.contact_requests_count}</td>
                  <td>
                    {user.blocked_at ? (
                      <span title={user.blocked_reason ?? undefined}>⛔ موقوف</span>
                    ) : (
                      "✅ نشط"
                    )}
                  </td>
                  <td>
                    <button
                      className={user.blocked_at ? "button" : "button secondary"}
                      type="button"
                      disabled={busyPhone === user.phone}
                      onClick={() => void toggleBlock(user)}
                    >
                      {user.blocked_at ? "رفع الإيقاف" : "إيقاف"}
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
