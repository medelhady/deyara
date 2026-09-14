"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { DashboardStats } from "@/lib/dashboard-stats";

const refreshMs = 30_000;

function formatNumber(value: number) {
  return new Intl.NumberFormat("ar").format(value);
}

function formatClock(iso: string) {
  const date = new Date(iso);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
}

/**
 * The dashboard numbers, refreshed in place.
 *
 * Rendered from server data first so the page is never blank, then polled: an admin leaves this open
 * while owners are submitting listings, and a count that silently goes stale is worse than no count.
 */
export function DashboardLive({ initial }: { initial: DashboardStats }) {
  const [stats, setStats] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);

    try {
      const response = await fetch(`/api/admin/stats?t=${Date.now()}`, { cache: "no-store" });

      if (!response.ok) {
        setStale(true);
        return;
      }

      setStats((await response.json()) as DashboardStats);
      setStale(false);
    } catch {
      // A refresh that cannot reach the server keeps the last known numbers and says they are old.
      setStale(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), refreshMs);

    return () => clearInterval(timer);
  }, [refresh]);

  const tasks = [
    {
      key: "properties",
      icon: "🏠",
      title: "إعلانات بانتظار المراجعة",
      note: "مؤجرون أرسلوا عقاراتهم ولم تُنشر بعد",
      value: stats.pendingProperties,
      href: "/admin/properties",
      action: "راجع الإعلانات"
    },
    {
      key: "topups",
      icon: "💳",
      title: "إيصالات شحن بانتظار الموافقة",
      // The urgent ones are called out here because the cost of missing them is a paying renter who
      // hears nothing: past 24 hours from their receipt, WhatsApp refuses the reply that carries
      // their points and the owner number.
      note:
        stats.urgentTopups > 0
          ? `⏰ ${formatNumber(stats.urgentTopups)} منها قارب على 24 ساعة — بعدها لن تصل رسالة التأكيد لصاحبها`
          : "بعد موافقتك تُضاف الأوقية فورًا ويكمل طلب صاحبها",
      value: stats.pendingTopups,
      urgent: stats.urgentTopups > 0,
      href: "/admin/wallets",
      action: "راجع الشحن"
    },
    {
      key: "withdrawals",
      icon: "💸",
      title: "طلبات سحب بانتظار التحويل",
      note: "عمولات تسويق طلب أصحابها سحبها",
      value: stats.pendingWithdrawals,
      href: "/admin/wallets",
      action: "راجع السحوبات"
    }
  ];

  const open = tasks.filter((task) => task.value > 0);
  const waiting = open.reduce((total, task) => total + task.value, 0);

  /**
   * The numbers that mean something today.
   *
   * Published listings and delivered numbers are the measures of the full flow; while collection
   * mode is on they are zero for a reason, and four zeros read as a dead business rather than as a
   * flow that is deliberately switched off.
   */
  const metrics = stats.collectionMode
    ? [
        {
          label: "مسجّل في القائمة",
          value: stats.collectionOffers + stats.collectionRequests,
          note: `${formatNumber(stats.collectionOffers)} عرض، و${formatNumber(stats.collectionRequests)} طلب`
        },
        {
          label: "وصل اليوم",
          value: stats.collectionToday,
          note: "عروض وطلبات سجّلها البوت منذ منتصف الليل"
        },
        {
          label: "رسالة اليوم",
          value: stats.conversationsToday,
          note: "واردة وصادرة عبر واتساب"
        },
        {
          label: "مستخدم",
          value: stats.owners + stats.renters,
          note: `${formatNumber(stats.owners)} مؤجر، ${formatNumber(stats.renters)} مستأجر`
        }
      ]
    : [
    {
      label: "إعلان منشور",
      value: stats.activeProperties,
      note: `من ${formatNumber(stats.totalProperties)} إجمالًا، و${formatNumber(stats.rentedProperties)} تأجّرت`
    },
    {
      label: "رقم سُلّم",
      value: stats.contactReveals,
      note: "كل رقم يعني أوقية مخصومة من مستأجر"
    },
    {
      label: "رسالة اليوم",
      value: stats.conversationsToday,
      note: "واردة وصادرة عبر واتساب"
    },
    {
      label: "مستخدم",
      value: stats.owners + stats.renters,
      note: `${formatNumber(stats.owners)} مؤجر، ${formatNumber(stats.renters)} مستأجر`
    }
      ];

  return (
    <>
      <header className="dash-hero">
        <div>
          <p className="eyebrow">لوحة الإدارة</p>
          <h1>الديارة</h1>
          <p className="dash-hero-line">
            {waiting > 0
              ? `${formatNumber(waiting)} عنصر ينتظر قرارك الآن.`
              : /**
                 * In collection mode there is nothing to approve by design, so "everything is
                 * covered" would be a dashboard congratulating itself while four hundred people
                 * wait for a call nobody has made.
                 */
                stats.collectionMode && stats.collectionUncontacted > 0
                ? `${formatNumber(stats.collectionUncontacted)} رقمًا لم تتواصل معه بعد.`
                : "لا شيء ينتظر قرارك. كل الطلبات مغطاة."}
          </p>
        </div>

        <div className="dash-hero-side">
          <button className="dash-refresh" type="button" onClick={() => void refresh()} disabled={refreshing}>
            <span className={refreshing ? "dash-dot is-busy" : "dash-dot"} />
            {refreshing ? "يحدّث..." : `آخر تحديث ${formatClock(stats.readAt)}`}
          </button>
          {stale ? <span className="dash-stale">تعذّر التحديث — الأرقام قد تكون قديمة</span> : null}
        </div>
      </header>

      {stats.failedNotifications !== null && stats.failedNotifications > 0 ? (
        <Link className="dash-alert" href="/admin/notifications">
          <span className="dash-alert-icon">⚠️</span>
          <span>
            <strong>{formatNumber(stats.failedNotifications)} إشعار لم يصل</strong> خلال آخر 24 ساعة.
            افتح السجل لمعرفة السبب.
          </span>
          <span className="dash-alert-go">←</span>
        </Link>
      ) : null}

      {/**
       * The work of the day, at the top and larger than anything else.
       *
       * While collection mode is on this is the only page with anything in it: the listings, the
       * fees and the reveals are all zero by design, and burying the one live list among twelve
       * identical cards is how an admin opens the dashboard and sees a business doing nothing.
       */}
      <Link className="dash-feature" href="/admin/collection">
        <span className="dash-feature-icon" aria-hidden="true">
          📋
        </span>
        <span className="dash-feature-text">
          <strong>الطلبات والعروض</strong>
          <span>ما جمعه البوت من الطرفين، مرتّبًا بالمقاطعة — ومن بقي بلا اتصال.</span>
        </span>
        <span className="dash-feature-figures">
          <span className="dash-figure">
            <strong>{formatNumber(stats.collectionOffers)}</strong>
            <small>عرض مؤجّر</small>
          </span>
          <span className="dash-figure">
            <strong>{formatNumber(stats.collectionRequests)}</strong>
            <small>طلب مستأجر</small>
          </span>
          <span className={stats.collectionUncontacted > 0 ? "dash-figure is-urgent" : "dash-figure"}>
            <strong>{formatNumber(stats.collectionUncontacted)}</strong>
            <small>لم تتواصل معهم</small>
          </span>
          <span className="dash-figure">
            <strong>{formatNumber(stats.collectionToday)}</strong>
            <small>وصل اليوم</small>
          </span>
        </span>
        <span className="dash-feature-go" aria-hidden="true">
          ←
        </span>
      </Link>

      <section className="dash-section" aria-label="يحتاج قرارك">
        <div className="dash-section-head">
          <h2>يحتاج قرارك</h2>
          {open.length > 0 ? <span className="dash-count">{formatNumber(waiting)}</span> : null}
        </div>

        {open.length === 0 ? (
          <div className="dash-clear">
            <span className="dash-clear-mark">✓</span>
            <div>
              <strong>ما فيه شي معلّق</strong>
              <p>راجعت كل الإعلانات والشحن والسحوبات. البوت يكمل الباقي وحده.</p>
            </div>
          </div>
        ) : (
          <div className="dash-tasks">
            {open.map((task) => (
              <article className={task.urgent ? "dash-task is-urgent" : "dash-task"} key={task.key}>
                <span className="dash-task-icon" aria-hidden="true">
                  {task.icon}
                </span>
                <span className="dash-task-value">{formatNumber(task.value)}</span>
                <div className="dash-task-text">
                  <strong>{task.title}</strong>
                  <p>{task.note}</p>
                </div>
                <Link className="button" href={task.href}>
                  {task.action}
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="dash-metrics" aria-label="أرقام المنصة">
        {metrics.map((metric) => (
          <article className="dash-metric" key={metric.label}>
            <strong>{formatNumber(metric.value)}</strong>
            <span>{metric.label}</span>
            <p>{metric.note}</p>
          </article>
        ))}
      </section>
    </>
  );
}
