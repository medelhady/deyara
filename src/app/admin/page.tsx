import Link from "next/link";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DashboardStats = {
  totalProperties: number;
  activeProperties: number;
  pendingProperties: number;
  pendingContactRequests: number;
  approvedContactRequests: number;
  conversationsToday: number;
  owners: number;
  renters: number;
};

async function countRows(
  table: string,
  filters: Array<{ column: string; value: string }> = []
) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return 0;
  }

  let query = supabase.from(table).select("*", { count: "exact", head: true });

  for (const filter of filters) {
    query = query.eq(filter.column, filter.value);
  }

  const { count, error } = await query;

  if (error) {
    console.error(`Failed to count ${table}`, error);
    return 0;
  }

  return count ?? 0;
}

async function loadDashboardStats(): Promise<DashboardStats> {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return {
      totalProperties: 0,
      activeProperties: 0,
      pendingProperties: 0,
      pendingContactRequests: 0,
      approvedContactRequests: 0,
      conversationsToday: 0,
      owners: 0,
      renters: 0
    };
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [
    totalProperties,
    activeProperties,
    pendingProperties,
    pendingContactRequests,
    approvedContactRequests,
    owners,
    renters,
    conversations
  ] = await Promise.all([
    countRows("properties"),
    countRows("properties", [{ column: "status", value: "active" }]),
    countRows("properties", [{ column: "status", value: "pending_review" }]),
    countRows("contact_requests", [{ column: "status", value: "pending_admin_review" }]),
    countRows("contact_requests", [{ column: "status", value: "approved" }]),
    countRows("users", [{ column: "role", value: "owner" }]),
    countRows("users", [{ column: "role", value: "renter" }]),
    supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .gte("created_at", today.toISOString())
  ]);

  return {
    totalProperties,
    activeProperties,
    pendingProperties,
    pendingContactRequests,
    approvedContactRequests,
    owners,
    renters,
    conversationsToday: conversations.count ?? 0
  };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ar").format(value);
}

export default async function AdminPage() {
  const stats = await loadDashboardStats();
  const reviewItems = [
    {
      title: "عقارات بانتظار المراجعة",
      value: stats.pendingProperties,
      href: "/admin/properties",
      action: "مراجعة العقارات"
    },
    {
      title: "إيصالات تحتاج موافقة",
      value: stats.pendingContactRequests,
      href: "/admin/contact-requests",
      action: "مراجعة الطلبات"
    }
  ];

  const cards = [
    {
      title: "العقارات",
      value: stats.totalProperties,
      note: `${formatNumber(stats.activeProperties)} نشط الآن`
    },
    {
      title: "طلبات التواصل",
      value: stats.pendingContactRequests,
      note: `${formatNumber(stats.approvedContactRequests)} طلب مقبول`
    },
    {
      title: "محادثات اليوم",
      value: stats.conversationsToday,
      note: "رسائل واتساب داخلة وخارجة"
    },
    {
      title: "المستخدمون",
      value: stats.owners + stats.renters,
      note: `${formatNumber(stats.owners)} مؤجر، ${formatNumber(stats.renters)} مستأجر`
    }
  ];

  return (
    <main className="admin-shell" dir="rtl">
      <header className="admin-hero">
        <div>
          <p className="eyebrow">Admin only</p>
          <h1>لوحة إدارة الديارة</h1>
          <p>متابعة العقارات، الموافقات، وطلبات التواصل من مكان واحد.</p>
        </div>
        <div className="hero-actions">
          <span className="status">MVP</span>
          <Link className="button" href="/admin/properties">
            مراجعة العقارات
          </Link>
        </div>
      </header>

      <section className="stats-grid" aria-label="إحصائيات المنصة">
        {cards.map((card) => (
          <article className="metric-card" key={card.title}>
            <span>{card.title}</span>
            <strong>{formatNumber(card.value)}</strong>
            <p>{card.note}</p>
          </article>
        ))}
      </section>

      <section className="dashboard-grid">
        <article className="panel priority-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">اليوم</p>
              <h2>الأشياء التي تحتاج قرارًا</h2>
            </div>
          </div>

          {reviewItems.map((item) => (
            <div className="review-item" key={item.title}>
              <div>
                <strong>{formatNumber(item.value)}</strong>
                <span>{item.title}</span>
              </div>
              <Link className="button secondary" href={item.href}>
                {item.action}
              </Link>
            </div>
          ))}
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">اختبار</p>
              <h2>واتساب قبل الإطلاق</h2>
            </div>
          </div>
          <p>
            جرّب إضافة عقار، البحث، مشاهدة الفيديو، ثم طلب الرقم قبل ربط رقم واتساب الحقيقي.
          </p>
          <div className="quick-actions">
            <Link className="button" href="/admin/simulator">
              فتح المحاكي
            </Link>
            <Link className="button secondary" href="/admin/contact-requests">
              طلبات التواصل
            </Link>
            <Link className="button secondary" href="/admin/dictionary">
              قاموس البوت
            </Link>
          </div>
        </article>
      </section>

      <section className="panel flow-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">التدفق الأساسي</p>
            <h2>كيف تمشي العملية داخل واتساب</h2>
          </div>
        </div>
        <div className="flow-steps">
          <span>المؤجر يرسل العقار والفيديو</span>
          <span>الإدارة توافق على النشر</span>
          <span>المستأجر يبحث ويشاهد الفيديو</span>
          <span>يدفع الرسوم ويرسل الإيصال</span>
          <span>الإدارة ترسل رقم المؤجر بعد الموافقة</span>
        </div>
      </section>
    </main>
  );
}
