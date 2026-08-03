"use client";

import { useEffect, useState } from "react";

type Wallet = {
  phone: string;
  usage_points: number;
  commission_points: number;
  withdrawn_commission_points: number;
  referral_code: string | null;
  referred_by_phone: string | null;
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

export function WalletsClient() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
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

  useEffect(() => {
    void loadWallets();
  }, []);

  return (
    <section className="wallets-layout">
      {message ? <p>{message}</p> : null}

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
        <div className="list-panel compact-list">
          {wallets.map((wallet) => (
            <article className="property-row" key={wallet.phone}>
              <div>
                <h2>{wallet.phone}</h2>
                <p>نقاط الاستخدام: {wallet.usage_points}</p>
                <p>نقاط التسويق: {wallet.commission_points}</p>
                <p>نقاط مسحوبة: {wallet.withdrawn_commission_points}</p>
                <p>كود الدعوة: {wallet.referral_code ?? "غير محدد"}</p>
                <p>جاء عن طريق: {wallet.referred_by_phone ?? "مباشر"}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
