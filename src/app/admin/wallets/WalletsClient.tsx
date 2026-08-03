"use client";

import { useEffect, useState } from "react";

type Wallet = {
  phone: string;
  usage_points: number;
  commission_points: number;
  withdrawn_commission_points: number;
  referral_code: string | null;
  referred_by_phone: string | null;
  referrals_count: number;
  created_at: string;
};

type Withdrawal = {
  id: string;
  phone: string;
  points: number;
  status: string;
  admin_note: string | null;
  created_at: string;
};

type Topup = {
  id: string;
  phone: string;
  points: number | null;
  receipt_image_url: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
};

export function WalletsClient() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [topups, setTopups] = useState<Topup[]>([]);
  const [topupPoints, setTopupPoints] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("جار تحميل المحافظ...");

  async function loadWallets() {
    const response = await fetch(`/api/admin/wallets?t=${Date.now()}`, {
      cache: "no-store"
    });
    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error ?? "تعذر تحميل المحافظ.");
      return;
    }

    setWallets(data.wallets ?? []);
    setWithdrawals(data.withdrawals ?? []);
    setTopups(data.topups ?? []);
    setMessage("");
  }

  async function updateWithdrawal(id: string, status: "approved" | "rejected" | "paid") {
    const response = await fetch(`/api/admin/withdrawals/${id}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status })
    });
    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error ?? "تعذر تحديث طلب السحب.");
      return;
    }

    await loadWallets();
  }

  async function updateTopup(id: string, status: "approved" | "rejected") {
    const response = await fetch(`/api/admin/topups/${id}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        status,
        points: Number(topupPoints[id] ?? 0)
      })
    });
    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error ?? "تعذر تحديث طلب الشحن.");
      return;
    }

    await loadWallets();
  }

  useEffect(() => {
    void loadWallets();
  }, []);

  return (
    <section className="wallets-layout">
      {message ? <p>{message}</p> : null}

      <section className="panel">
        <h2>طلبات شحن النقاط</h2>
        {topups.length === 0 ? <p>لا توجد طلبات شحن حتى الآن.</p> : null}
        <div className="list-panel compact-list">
          {topups.map((topup) => (
            <article className="property-row" key={topup.id}>
              <div>
                <h2>{topup.phone}</h2>
                <p>الحالة: {topup.status}</p>
                <p>النقاط: {topup.points ?? "لم تحدد"}</p>
                <p>التاريخ: {new Date(topup.created_at).toLocaleString("ar")}</p>
                <p>
                  الإيصال:{" "}
                  {topup.receipt_image_url ? (
                    <a href={topup.receipt_image_url} target="_blank" rel="noreferrer">
                      فتح الإيصال
                    </a>
                  ) : (
                    "غير موجود"
                  )}
                </p>
              </div>
              <div className="row-actions stacked-actions">
                <input
                  type="number"
                  min="1"
                  placeholder="عدد النقاط"
                  value={topupPoints[topup.id] ?? ""}
                  onChange={(event) => setTopupPoints((current) => ({ ...current, [topup.id]: event.target.value }))}
                />
                <button type="button" onClick={() => updateTopup(topup.id, "approved")}>
                  قبول الشحن
                </button>
                <button type="button" onClick={() => updateTopup(topup.id, "rejected")}>
                  رفض
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>طلبات السحب</h2>
        {withdrawals.length === 0 ? <p>لا توجد طلبات سحب حتى الآن.</p> : null}
        <div className="list-panel compact-list">
          {withdrawals.map((withdrawal) => (
            <article className="property-row" key={withdrawal.id}>
              <div>
                <h2>{withdrawal.phone}</h2>
                <p>النقاط: {withdrawal.points}</p>
                <p>الحالة: {withdrawal.status}</p>
                <p>التاريخ: {new Date(withdrawal.created_at).toLocaleString("ar")}</p>
              </div>
              <div className="row-actions">
                <button type="button" onClick={() => updateWithdrawal(withdrawal.id, "approved")}>
                  قبول
                </button>
                <button type="button" onClick={() => updateWithdrawal(withdrawal.id, "paid")}>
                  تم الدفع
                </button>
                <button type="button" onClick={() => updateWithdrawal(withdrawal.id, "rejected")}>
                  رفض
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>المحافظ</h2>
        {wallets.length === 0 ? <p>لا توجد محافظ حتى الآن.</p> : null}
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>الرقم</th>
                <th>رصيد الاستخدام</th>
                <th>رصيد التسويق</th>
                <th>الرصيد المسحوب</th>
                <th>عدد الإحالات</th>
                <th>كود الدعوة</th>
                <th>محال من طرف</th>
              </tr>
            </thead>
            <tbody>
              {wallets.map((wallet) => (
                <tr key={wallet.phone}>
                  <td>
                    <strong>{wallet.phone}</strong>
                  </td>
                  <td>{wallet.usage_points}</td>
                  <td>{wallet.commission_points}</td>
                  <td>{wallet.withdrawn_commission_points}</td>
                  <td>{wallet.referrals_count}</td>
                  <td>{wallet.referral_code ?? "غير محدد"}</td>
                  <td>{wallet.referred_by_phone ?? "مباشر"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
