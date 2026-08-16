'use client';

import { useEffect, useMemo, useState } from 'react';

type WithdrawalStatus = 'paid' | 'rejected' | 'pending';

type Withdrawal = {
  id: number;
  phone: string;
  amount: number;
  status: WithdrawalStatus;
  date: string;
};

type Referral = {
  phone: string;
  joins: number;
  market: number;
  cashout: number;
  refs: number;
  type: string;
  code: string;
  from: string;
};

type CreditTopup = {
  id: string;
  phone: string;
  points: number | null;
  receipt_image_url: string | null;
  status: string;
  created_at: string;
};

const sealStyle: Record<WithdrawalStatus, { c: string; bg: string; icon: string }> = {
  paid: { c: '#2f6e4e', bg: '#dfeee1', icon: '✓' },
  rejected: { c: '#9c3b27', bg: '#f5e2da', icon: '×' },
  pending: { c: '#b9832a', bg: '#f7ecd4', icon: '…' },
};

const statusLabel: Record<WithdrawalStatus, string> = {
  paid: 'مدفوع',
  rejected: 'مرفوض',
  pending: 'قيد الانتظار',
};

const initialWithdrawals: Withdrawal[] = [
  { id: 1, phone: '+222 41 00 10 03', amount: 500, status: 'paid', date: '2026/08/03 — 8:59 م' },
  { id: 2, phone: '+222 41 00 10 05', amount: 500, status: 'paid', date: '2026/08/03 — 8:59 م' },
  { id: 3, phone: '+222 41 00 10 01', amount: 540, status: 'paid', date: '2026/08/03 — 8:59 م' },
  { id: 4, phone: '+222 41 00 10 07', amount: 320, status: 'pending', date: '2026/08/03 — 9:14 م' },
];

const referrals: Referral[] = [
  { phone: '+222 41 00 10 03', joins: 20, market: 760, cashout: 500, refs: 20, type: 'رابط مباشر', code: 'RM-1003', from: '—' },
  { phone: '+222 41 00 10 02', joins: 4, market: 320, cashout: 80, refs: 4, type: 'واتساب', code: 'RM-1002', from: '+222 41 00 10 03' },
  { phone: '+222 41 00 10 04', joins: 0, market: 120, cashout: 0, refs: 0, type: 'رابط مباشر', code: 'RM-1004', from: '—' },
  { phone: '+222 00 00 00 00', joins: 0, market: 0, cashout: 0, refs: 0, type: 'رابط مباشر', code: 'RM-0000', from: '—' },
  { phone: '+222 41 00 10 05', joins: 9, market: 800, cashout: 500, refs: 9, type: 'واتساب', code: 'RM-1005', from: '+222 41 00 10 01' },
  { phone: '+222 41 00 10 01', joins: 12, market: 0, cashout: 540, refs: 12, type: 'رابط مباشر', code: 'RM-1001', from: '—' },
];

const cols: { key: keyof Referral; label: string }[] = [
  { key: 'phone', label: 'الرقم' },
  { key: 'refs', label: 'عدد الإحالات' },
  { key: 'joins', label: 'ربح الانضمام' },
  { key: 'market', label: 'ربح التسويق' },
  { key: 'cashout', label: 'ربح مسحوب' },
];

export function WalletsClient() {
  const [creditTopups, setCreditTopups] = useState<CreditTopup[]>([]);
  const [topupMessage, setTopupMessage] = useState('جار تحميل طلبات الشحن...');
  const [topupPointsInput, setTopupPointsInput] = useState<Record<string, string>>({});

  async function loadCreditTopups() {
    const response = await fetch(`/api/admin/credit-topups?t=${Date.now()}`, { cache: 'no-store' });
    const data = await response.json();

    if (data.mode === 'mock') {
      setTopupMessage('Supabase غير مربوط بعد.');
      setCreditTopups([]);
      return;
    }

    const pending = (data.creditTopups ?? []).filter((item: CreditTopup) => item.status === 'pending');
    setCreditTopups(pending);
    setTopupMessage(pending.length ? '' : 'لا توجد طلبات شحن حتى الآن.');
  }

  async function updateTopupStatus(id: string, status: 'approved' | 'rejected') {
    const points = Number(topupPointsInput[id] ?? '0');

    if (status === 'approved' && (!points || points <= 0)) {
      showToast('أدخل عدد النقاط قبل القبول');
      return;
    }

    const response = await fetch(`/api/admin/credit-topups/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(status === 'approved' ? { status, points } : { status })
    });

    if (!response.ok) {
      const data = await response.json();
      showToast(data.error ?? 'تعذر تحديث طلب الشحن.');
      return;
    }

    showToast(status === 'approved' ? 'تم قبول الشحن وإضافة النقاط' : 'تم رفض طلب الشحن');
    await loadCreditTopups();
  }

  useEffect(() => {
    void loadCreditTopups();
  }, []);

  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>(initialWithdrawals);
  const [sortKey, setSortKey] = useState<keyof Referral>('refs');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);

  const showToast = (msg: string) => {
    const id = Date.now();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2000);
  };

  const copyPhone = (phone: string) => {
    navigator.clipboard?.writeText(phone).catch(() => {});
    showToast('تم نسخ الرقم ' + phone);
  };

  const setStatus = (id: number, status: WithdrawalStatus) => {
    setWithdrawals((list) => list.map((w) => (w.id === id ? { ...w, status } : w)));
    const w = withdrawals.find((x) => x.id === id);
    const msgs: Record<WithdrawalStatus, string> = {
      paid: 'تم قبول الطلب وتحديد الحالة كمدفوع',
      rejected: 'تم رفض الطلب',
      pending: 'أعيد الطلب إلى قيد الانتظار',
    };
    showToast(msgs[status] + (w ? ' — ' + w.phone : ''));
  };

  const sortBy = (key: keyof Referral) => {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(-1);
    }
  };

  const hero = useMemo(() => {
    const paidTotal = withdrawals.filter((w) => w.status === 'paid').reduce((s, w) => s + w.amount, 0);
    const pendingCount = withdrawals.filter((w) => w.status === 'pending').length;
    const totalRefs = referrals.reduce((s, r) => s + r.refs, 0);
    const totalMarket = referrals.reduce((s, r) => s + r.market, 0);
    return [
      { lab: 'مسحوبات مدفوعة اليوم', num: paidTotal.toLocaleString() },
      { lab: 'طلبات قيد الانتظار', num: String(pendingCount) },
      { lab: 'إجمالي الإحالات', num: String(totalRefs) },
      { lab: 'أرباح التسويق الكلية', num: totalMarket.toLocaleString() },
    ];
  }, [withdrawals]);

  const pendingCount = withdrawals.filter((w) => w.status === 'pending').length;

  const rows = useMemo(() => {
    const filtered = referrals.filter(
      (r) => !search || r.phone.replace(/\s/g, '').includes(search.replace(/\s/g, ''))
    );
    return [...filtered].sort((a, b) => ((a[sortKey] as any) > (b[sortKey] as any) ? 1 : -1) * sortDir);
  }, [search, sortKey, sortDir]);

  const cell = (v: number) => (v === 0 ? <span style={{ color: 'var(--ink-soft)', opacity: 0.55 }}>0</span> : v.toLocaleString());

  return (
    <div dir="rtl" style={{ background: 'var(--sand)', minHeight: '100vh', padding: '28px 16px 80px', fontFamily: "'Tajawal', sans-serif" }}>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        :root{
          --ink:#182338; --ink-soft:#4a5674; --sand:#efe6d0; --sand-deep:#e2d3ac;
          --paper:#faf5e8; --paper-2:#fffdf7; --gold:#a97a26; --gold-deep:#7c5716; --gold-bg:#f5ecd6;
          --green:#2f6e4e; --green-bg:#dfeee1; --rust:#9c3b27; --rust-bg:#f5e2da;
          --amber:#b9832a; --amber-bg:#f7ecd4; --border:#d9c99e; --radius:14px;
        }
        .wc-wrap{max-width:880px;margin:0 auto;}
        .wc-title{font-family:'El Messiri',serif;font-weight:700;font-size:32px;margin:0 0 26px;color:var(--ink);text-align:center;position:relative;padding-bottom:16px;}
        .wc-title::after{content:"";position:absolute;bottom:0;right:50%;transform:translateX(50%);width:120px;height:3px;background-image:repeating-linear-gradient(-45deg,var(--gold) 0 4px, transparent 4px 8px);}
        .wc-hero{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:26px;}
        .wc-stat{background:var(--paper-2);border:1px solid var(--border);border-radius:var(--radius);padding:14px 12px;text-align:center;position:relative;overflow:hidden;}
        .wc-stat::before{content:"";position:absolute;top:0;right:0;left:0;height:5px;background-image:repeating-linear-gradient(-45deg, var(--gold) 0 5px, var(--gold-deep) 5px 10px);}
        .wc-stat .num{font-family:'IBM Plex Mono';font-weight:600;font-size:21px;color:var(--ink);display:block;margin-top:4px;}
        .wc-stat .lab{font-size:11.5px;color:var(--ink-soft);}
        .wc-section-head{display:flex;align-items:center;gap:10px;margin:30px 0 14px;}
        .wc-section-head h2{font-family:'El Messiri',serif;font-size:19px;font-weight:600;margin:0;color:var(--ink);}
        .wc-line{flex:1;height:1px;background:var(--border);}
        .wc-tag{font-family:'IBM Plex Mono';font-size:11px;color:var(--gold-deep);background:var(--gold-bg);padding:2px 9px;border-radius:999px;border:1px solid var(--border);}
        .wc-card{background:var(--paper-2);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:12px;overflow:hidden;}
        .wc-ribbon{height:6px;width:100%;}
        .wc-body{padding:16px 18px;display:flex;align-items:center;gap:14px;}
        .wc-seal{width:46px;height:46px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;font-family:'IBM Plex Mono';border:2px dashed;}
        .wc-info{flex:1;min-width:0;}
        .wc-phone-row{display:flex;align-items:center;gap:8px;cursor:pointer;}
        .wc-phone{font-family:'IBM Plex Mono';font-weight:600;font-size:15px;color:var(--ink);direction:ltr;text-align:right;}
        .wc-meta{display:flex;gap:14px;margin-top:5px;font-size:12.5px;color:var(--ink-soft);flex-wrap:wrap;}
        .wc-amount{font-family:'IBM Plex Mono';font-size:20px;font-weight:600;color:var(--gold-deep);white-space:nowrap;}
        .wc-amount span{font-size:12px;font-weight:400;color:var(--ink-soft);}
        .wc-actions{display:flex;gap:6px;padding:0 18px 16px;flex-wrap:wrap;}
        .wc-btn{font-family:'Tajawal';font-size:12.5px;font-weight:500;padding:7px 14px;border-radius:8px;border:1px solid var(--border);background:var(--paper);cursor:pointer;color:var(--ink-soft);}
        .wc-btn:disabled{opacity:.35;cursor:not-allowed;}
        .wc-badge{font-family:'IBM Plex Mono';font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;}
        .wc-search{width:100%;background:var(--paper-2);border:1px solid var(--border);border-radius:10px;padding:9px 14px;font-family:'Tajawal';font-size:13px;color:var(--ink);outline:none;margin-bottom:12px;}
        table{width:100%;border-collapse:collapse;background:var(--paper-2);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;}
        thead th{font-family:'Tajawal';font-weight:700;font-size:12px;color:var(--gold-deep);background:var(--gold-bg);padding:11px 8px;text-align:center;cursor:pointer;white-space:nowrap;border-bottom:1px solid var(--border);}
        tbody td{padding:11px 8px;text-align:center;font-size:13px;border-bottom:1px solid var(--sand-deep);}
        tbody tr.wc-row{cursor:pointer;}
        tbody tr.wc-row:hover{background:var(--gold-bg);}
        tbody td.wc-phone-cell{font-family:'IBM Plex Mono';font-weight:600;direction:ltr;}
        tr.wc-detail td{background:var(--paper);text-align:right;padding:14px 22px;border-bottom:1px solid var(--sand-deep);}
        .wc-detail-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;font-size:12.5px;}
        .wc-detail-grid div span{display:block;color:var(--ink-soft);font-size:11px;margin-bottom:2px;}
        #wc-toast-wrap{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;z-index:50;}
        .wc-toast{background:var(--ink);color:var(--paper-2);font-family:'Tajawal';font-size:13px;font-weight:500;padding:10px 20px;border-radius:999px;white-space:nowrap;}
        @media(max-width:600px){.wc-hero{grid-template-columns:repeat(2,1fr);}.wc-detail-grid{grid-template-columns:repeat(2,1fr);}}
      `,
        }}
      />

      <div className="wc-wrap">
        <h1 className="wc-title">النقاط والإحالات</h1>

        <div className="wc-hero">
          {hero.map((s) => (
            <div className="wc-stat" key={s.lab}>
              <span className="lab">{s.lab}</span>
              <span className="num">{s.num}</span>
            </div>
          ))}
        </div>

        <div className="wc-section-head">
          <h2>طلبات شحن النقاط</h2>
          <div className="wc-line" />
          <span className="wc-tag">{creditTopups.length} قيد الانتظار</span>
        </div>

        {topupMessage ? <p>{topupMessage}</p> : null}

        {creditTopups.map((t) => (
          <div className="wc-card" key={t.id}>
            <div className="wc-ribbon" style={{ backgroundImage: 'repeating-linear-gradient(-45deg, var(--amber) 0 5px, var(--amber) 5px 10px)' }} />
            <div className="wc-body">
              <div className="wc-seal" style={{ background: 'var(--amber-bg)', color: 'var(--amber)', borderColor: 'var(--amber)' }}>…</div>
              <div className="wc-info">
                <div className="wc-phone-row" onClick={() => copyPhone(t.phone)}>
                  <span className="wc-phone">{t.phone}</span>
                </div>
                <div className="wc-meta">
                  <span>التاريخ <b>{new Date(t.created_at).toLocaleString('ar')}</b></span>
                  {t.receipt_image_url ? (
                    <a href={t.receipt_image_url} target="_blank" rel="noreferrer">فتح الإيصال</a>
                  ) : (
                    <span>لا يوجد إيصال</span>
                  )}
                </div>
              </div>
              <input
                type="number"
                placeholder="عدد النقاط"
                className="wc-search"
                style={{ width: 110, marginBottom: 0 }}
                value={topupPointsInput[t.id] ?? ''}
                onChange={(e) => setTopupPointsInput((prev) => ({ ...prev, [t.id]: e.target.value }))}
              />
            </div>
            <div className="wc-actions">
              <button className="wc-btn" style={{ borderColor: 'var(--green)', color: 'var(--green)' }} onClick={() => updateTopupStatus(t.id, 'approved')}>قبول وإضافة النقاط</button>
              <button className="wc-btn" style={{ borderColor: 'var(--rust)', color: 'var(--rust)' }} onClick={() => updateTopupStatus(t.id, 'rejected')}>رفض</button>
            </div>
          </div>
        ))}

        <div className="wc-section-head">
          <h2>طلبات السحب</h2>
          <div className="wc-line" />
          <span className="wc-tag">{pendingCount} قيد الانتظار</span>
        </div>

        {withdrawals.map((w) => {
          const s = sealStyle[w.status];
          return (
            <div className="wc-card" key={w.id}>
              <div className="wc-ribbon" style={{ backgroundImage: `repeating-linear-gradient(-45deg, ${s.c} 0 5px, ${s.c} 5px 10px)` }} />
              <div className="wc-body">
                <div className="wc-seal" style={{ background: s.bg, color: s.c, borderColor: s.c }}>{s.icon}</div>
                <div className="wc-info">
                  <div className="wc-phone-row" onClick={() => copyPhone(w.phone)}>
                    <span className="wc-phone">{w.phone}</span>
                  </div>
                  <div className="wc-meta">
                    <span>
                      الحالة{' '}
                      <span className="wc-badge" style={{ background: s.bg, color: s.c }}>{statusLabel[w.status]}</span>
                    </span>
                    <span>التاريخ <b>{w.date}</b></span>
                  </div>
                </div>
                <div className="wc-amount">{w.amount} <span>نقطة</span></div>
              </div>
              <div className="wc-actions">
                <button className="wc-btn" style={{ borderColor: 'var(--green)', color: 'var(--green)' }} disabled={w.status === 'paid'} onClick={() => setStatus(w.id, 'paid')}>قبول</button>
                <button className="wc-btn" style={{ borderColor: 'var(--rust)', color: 'var(--rust)' }} disabled={w.status === 'rejected'} onClick={() => setStatus(w.id, 'rejected')}>رفض</button>
                <button className="wc-btn" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }} onClick={() => setStatus(w.id, 'pending')}>إعادة تفعيل</button>
              </div>
            </div>
          );
        })}

        <div className="wc-section-head">
          <h2>سجل الإحالات</h2>
          <div className="wc-line" />
          <span className="wc-tag">{referrals.length} رقم</span>
        </div>

        <input className="wc-search" placeholder="ابحث برقم الهاتف..." value={search} onChange={(e) => setSearch(e.target.value)} />

        <table>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} onClick={() => sortBy(c.key)}>
                  {c.label} {sortKey === c.key ? (sortDir === 1 ? '↑' : '↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 22, color: 'var(--ink-soft)' }}>لا توجد نتائج مطابقة</td></tr>
            )}
            {rows.map((r) => (
              <>
                <tr className="wc-row" key={r.phone} onClick={() => setExpanded(expanded === r.phone ? null : r.phone)}>
                  <td className="wc-phone-cell">{r.phone}</td>
                  <td>{cell(r.refs)}</td>
                  <td>{cell(r.joins)}</td>
                  <td>{cell(r.market)}</td>
                  <td>{cell(r.cashout)}</td>
                </tr>
                {expanded === r.phone && (
                  <tr className="wc-detail" key={r.phone + '-d'}>
                    <td colSpan={5}>
                      <div className="wc-detail-grid">
                        <div><span>نوع الدعوة</span><b>{r.type}</b></div>
                        <div><span>رمز الإحالة</span><b>{r.code}</b></div>
                        <div><span>محول من طرف</span><b>{r.from}</b></div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      <div id="wc-toast-wrap">
        {toasts.map((t) => (
          <div className="wc-toast" key={t.id}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}