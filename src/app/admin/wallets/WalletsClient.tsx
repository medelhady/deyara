'use client';

import { useEffect, useMemo, useState } from 'react';

type CreditTopup = {
  id: string;
  phone: string;
  points: number | null;
  receipt_image_url: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
  updated_at: string | null;
};

type Withdrawal = {
  id: string;
  phone: string;
  points: number;
  status: string;
  payout_note: string | null;
  admin_note: string | null;
  created_at: string;
};

type Wallet = {
  phone: string;
  usage_points: number | null;
  commission_points: number | null;
  referral_code: string | null;
  referred_by_phone: string | null;
  referrals_count: number;
};

const statusLabels: Record<string, string> = {
  pending: 'قيد الانتظار',
  approved: 'مقبول',
  rejected: 'مرفوض',
  paid: 'مدفوع'
};

const replyWindowHours = 24;

/**
 * How much of the 24-hour reply window is left for this receipt.
 *
 * The renter has already sent money. Once 24 hours pass since their message, WhatsApp refuses the
 * free-form reply that would carry their points and the owner's number, so approving late means
 * they paid and hear nothing back.
 */
function replyWindow(createdAt: string) {
  const sent = new Date(createdAt).getTime();

  if (Number.isNaN(sent)) {
    return null;
  }

  const hoursLeft = replyWindowHours - (Date.now() - sent) / (1000 * 60 * 60);

  if (hoursLeft <= 0) {
    return { level: 'closed' as const, label: '⛔ انتهت نافذة الرد — لن تصله رسالة التأكيد' };
  }

  if (hoursLeft <= 4) {
    return {
      level: 'urgent' as const,
      label: `⏰ باقي ${Math.max(1, Math.round(hoursLeft))} ساعة على إغلاق نافذة الرد`
    };
  }

  return { level: 'ok' as const, label: `باقي ${Math.round(hoursLeft)} ساعة على إغلاق نافذة الرد` };
}

function formatDateTime(value: string | null) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleString('ar', { dateStyle: 'short', timeStyle: 'short' });
}

export function WalletsClient() {
  const [topups, setTopups] = useState<CreditTopup[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [message, setMessage] = useState('جار تحميل البيانات...');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pointsInput, setPointsInput] = useState<Record<string, string>>({});
  const [showTopupLog, setShowTopupLog] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  async function loadAll() {
    const response = await fetch(`/api/admin/wallets?t=${Date.now()}`, { cache: 'no-store' });
    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error ?? 'تعذر تحميل البيانات.');
      return;
    }

    if (data.mode === 'mock') {
      setMessage('Supabase غير مربوط بعد. بعد إضافة المفاتيح ستظهر البيانات هنا.');
      return;
    }

    setTopups(data.topups ?? []);
    setWithdrawals(data.withdrawals ?? []);
    setWallets(data.wallets ?? []);
    setMessage('');
  }

  async function updateTopup(id: string, status: 'approved' | 'rejected') {
    const topup = topups.find((item) => item.id === id);
    const number = topup ? topup.phone.replace('whatsapp:', '') : '';
    const points = Number(pointsInput[id] ?? '');

    if (status === 'approved' && (!Number.isFinite(points) || points <= 0)) {
      setNotice({ kind: 'error', text: 'اكتب عدد النقاط قبل الموافقة.' });
      return;
    }

    setBusyId(id);
    setNotice(null);

    try {
      const response = await fetch(`/api/admin/credit-topups/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(status === 'approved' ? { status, points } : { status })
      });
      const data = await response.json();

      if (!response.ok) {
        setNotice({ kind: 'error', text: data.error ?? 'تعذر تحديث طلب الشحن.' });
        return;
      }

      // Approving makes the row disappear from the queue, which on its own is indistinguishable
      // from a tap that did nothing. Say what happened to whom.
      setNotice({
        kind: 'ok',
        text:
          status === 'approved'
            ? `تم اعتماد ${points} نقطة للرقم ${number}، وأُبلغ صاحبها.`
            : `تم رفض طلب الشحن للرقم ${number}، وأُبلغ صاحبه.`
      });

      await loadAll();
    } finally {
      setBusyId(null);
    }
  }

  async function updateWithdrawal(id: string, status: 'paid' | 'rejected') {
    const withdrawal = withdrawals.find((item) => item.id === id);
    const number = withdrawal ? withdrawal.phone.replace('whatsapp:', '') : '';

    setBusyId(id);
    setNotice(null);

    try {
      const response = await fetch(`/api/admin/withdrawals/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const data = await response.json();

      if (!response.ok) {
        setNotice({ kind: 'error', text: data.error ?? 'تعذر تحديث طلب السحب.' });
        return;
      }

      // Same as the top-up queue: the row leaves the list, which alone says nothing.
      setNotice({
        kind: 'ok',
        text:
          status === 'paid'
            ? `تم تأكيد تحويل ${withdrawal?.points ?? ''} نقطة للرقم ${number}، وخُصمت من رصيد عمولته.`
            : `تم رفض طلب السحب للرقم ${number}، ورصيده لم يتغير.`
      });

      await loadAll();
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  const pendingTopups = useMemo(() => topups.filter((item) => item.status === 'pending'), [topups]);
  const topupLog = useMemo(() => topups.filter((item) => item.status !== 'pending'), [topups]);
  const pendingWithdrawals = useMemo(() => withdrawals.filter((item) => item.status === 'pending'), [withdrawals]);

  const visibleWallets = useMemo(() => {
    const term = search.replace(/\s/g, '');
    return wallets.filter((wallet) => !term || wallet.phone.replace(/\s/g, '').includes(term));
  }, [wallets, search]);

  return (
    <>
      {message ? <p>{message}</p> : null}

      {/* Sticks to the top of the screen so the outcome is visible even when the tap that caused it
          was far down a long queue on a phone. */}
      {notice ? (
        <div className={`action-notice is-${notice.kind}`} role="status">
          <span>{notice.kind === 'ok' ? '✅' : '⚠️'}</span>
          <p>{notice.text}</p>
          <button type="button" aria-label="إغلاق" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">يحتاج قرارك</p>
            <h2>طلبات شحن النقاط</h2>
          </div>
          <span className="status">{pendingTopups.length}</span>
        </div>

        {pendingTopups.length === 0 ? (
          <p>لا توجد طلبات شحن بانتظار الموافقة.</p>
        ) : (
          pendingTopups.map((topup) => (
            <div className="review-item" key={topup.id}>
              <div>
                <strong>{topup.phone}</strong>
                <span>{formatDateTime(topup.created_at)}</span>
                {(() => {
                  const window = replyWindow(topup.created_at);

                  return window ? (
                    <span className={`reply-window is-${window.level}`}>{window.label}</span>
                  ) : null;
                })()}
                {topup.receipt_image_url ? (
                  // Shown, not linked: reading the amount off the receipt is the decision itself,
                  // and opening a tab per request made that needlessly slow.
                  <a
                    className="receipt-thumb"
                    href={topup.receipt_image_url}
                    target="_blank"
                    rel="noreferrer"
                    title="فتح الصورة بالحجم الكامل"
                  >
                    {/* Not lazy: it is the content of the decision, and a lazy image inside a
                        shrink-to-fit box never becomes visible enough to start loading. */}
                    <img src={topup.receipt_image_url} alt={`إيصال ${topup.phone}`} />
                  </a>
                ) : (
                  <span>بدون صورة إيصال</span>
                )}
              </div>
              <div className="inline-actions">
                <input
                  type="number"
                  placeholder="عدد النقاط"
                  value={pointsInput[topup.id] ?? String(topup.points ?? '')}
                  onChange={(event) =>
                    setPointsInput((current) => ({ ...current, [topup.id]: event.target.value }))
                  }
                />
                {/* The label carries the busy state. A disabled button alone is easy to miss on a
                    phone, so a tap that is working looks the same as one that did nothing. */}
                <button
                  className="button"
                  type="button"
                  disabled={busyId === topup.id}
                  onClick={() => void updateTopup(topup.id, 'approved')}
                >
                  {busyId === topup.id ? 'جارٍ الاعتماد...' : 'موافقة'}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  disabled={busyId === topup.id}
                  onClick={() => void updateTopup(topup.id, 'rejected')}
                >
                  {busyId === topup.id ? '...' : 'رفض'}
                </button>
              </div>
            </div>
          ))
        )}

        <button className="log-toggle" type="button" onClick={() => setShowTopupLog((open) => !open)}>
          {showTopupLog ? '▾' : '▸'} سجل الشحن ({topupLog.length})
        </button>

        {showTopupLog ? (
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>رقم العميل</th>
                  <th>النقاط</th>
                  <th>الحالة</th>
                  <th>تاريخ الطلب</th>
                  <th>تاريخ القرار</th>
                </tr>
              </thead>
              <tbody>
                {topupLog.length === 0 ? (
                  <tr>
                    <td colSpan={5}>لا يوجد سجل بعد.</td>
                  </tr>
                ) : (
                  topupLog.map((topup) => (
                    <tr key={topup.id}>
                      <td>{topup.phone}</td>
                      <td>{topup.points ?? '—'}</td>
                      <td>{statusLabels[topup.status] ?? topup.status}</td>
                      <td>{formatDateTime(topup.created_at)}</td>
                      <td>{formatDateTime(topup.updated_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">يحتاج قرارك</p>
            <h2>طلبات السحب</h2>
          </div>
          <span className="status">{pendingWithdrawals.length}</span>
        </div>

        {withdrawals.length === 0 ? (
          <p>لا توجد طلبات سحب.</p>
        ) : (
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>النقاط</th>
                  <th>الحالة</th>
                  <th>التاريخ</th>
                  <th>الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((withdrawal) => (
                  <tr key={withdrawal.id}>
                    <td>{withdrawal.phone}</td>
                    <td>{withdrawal.points}</td>
                    <td>{statusLabels[withdrawal.status] ?? withdrawal.status}</td>
                    <td>{formatDateTime(withdrawal.created_at)}</td>
                    <td>
                      {withdrawal.status === 'pending' ? (
                        <div className="inline-actions">
                          <button
                            className="button"
                            type="button"
                            disabled={busyId === withdrawal.id}
                            onClick={() => void updateWithdrawal(withdrawal.id, 'paid')}
                          >
                            {busyId === withdrawal.id ? 'جارٍ الحفظ...' : 'تم الدفع'}
                          </button>
                          <button
                            className="button secondary"
                            type="button"
                            disabled={busyId === withdrawal.id}
                            onClick={() => void updateWithdrawal(withdrawal.id, 'rejected')}
                          >
                            {busyId === withdrawal.id ? '...' : 'رفض'}
                          </button>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">المحافظ</p>
            <h2>الأرصدة والإحالات</h2>
          </div>
          <input
            type="search"
            placeholder="ابحث برقم الهاتف"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>الرقم</th>
                <th>نقاط الاستخدام</th>
                <th>نقاط التسويق</th>
                <th>عدد الإحالات</th>
                <th>كود الإحالة</th>
                <th>دُعي بواسطة</th>
              </tr>
            </thead>
            <tbody>
              {visibleWallets.length === 0 ? (
                <tr>
                  <td colSpan={6}>لا توجد محافظ ضمن هذا البحث.</td>
                </tr>
              ) : (
                visibleWallets.map((wallet) => (
                  <tr key={wallet.phone}>
                    <td>{wallet.phone}</td>
                    <td>{wallet.usage_points ?? 0}</td>
                    <td>{wallet.commission_points ?? 0}</td>
                    <td>{wallet.referrals_count}</td>
                    <td>{wallet.referral_code ?? '—'}</td>
                    <td>{wallet.referred_by_phone ?? '—'}</td>
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
