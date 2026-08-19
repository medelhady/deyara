import Link from "next/link";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DashboardStats = {
  totalProperties: number;
  activeProperties: number;
  pendingProperties: number;
  rejectedProperties: number;
  contactReveals: number;
  pendingTopups: number;
  pendingWithdrawals: number;
  conversationsToday: number;
  owners: number;
  renters: number;
};

const emptyStats: DashboardStats = {
  totalProperties: 0,
  activeProperties: 0,
  pendingProperties: 0,
  rejectedProperties: 0,
  contactReveals: 0,
  pendingTopups: 0,
  pendingWithdrawals: 0,
  conversationsToday: 0,
  owners: 0,
  renters: 0
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
    return emptyStats;
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [
    totalProperties,
    activeProperties,
    pendingProperties,
    rejectedProperties,
    contactReveals,
    pendingTopups,
    pendingWithdrawals,
    owners,
    renters,
    conversations
  ] = await Promise.all([
    countRows("properties"),
    countRows("properties", [{ column: "status", value: "active" }]),
    countRows("properties", [{ column: "status", value: "pending_review" }]),
    countRows("properties", [{ column: "status", value: "rejected" }]),
    countRows("contact_requests", [{ column: "status", value: "approved" }]),
    countRows("credit_topups", [{ column: "status", value: "pending" }]),
    countRows("withdrawal_requests", [{ column: "status", value: "pending" }]),
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
    rejectedProperties,
    contactReveals,
    pendingTopups,
    pendingWithdrawals,
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

  // Only what an admin still decides by hand. Releasing an owner number is automatic now.
  const reviewItems = [
    {
      title: "عقارات بانتظار المراجعة",
      note: "إعلانات مؤجرين لم تُنشر بعد",
      value: stats.pendingProperties,
      href: "/admin/properties",
      action: "مراجعة العقارات"
    },
    {
      title: "إيصالات شحن بانتظار الموافقة",
      note: "بعد الموافقة تُضاف النقاط فورًا",
      value: stats.pendingTopups,
      href: "/admin/wallets",
      action: "مراجعة الشحن"
    },
    {
      title: "طلبات سحب بانتظار الدفع",
      note: "عمولات تسويق طلب أصحابها سحبها",
      value: stats.pendingWithdrawals,
      href: "/admin/wallets",
      action: "مراجعة السحوبات"
    }
  ];

  const waitingCount = reviewItems.reduce((total, item) => total + item.value, 0);

  const cards = [
    {
      title: "العقارات",
      value: stats.totalProperties,
      note: `${formatNumber(stats.activeProperties)} منشور، ${formatNumber(stats.pendingProperties)} بانتظار المراجعة`
    },
    {
      title: "أرقام سُلّمت",
      value: stats.contactReveals,
      note: "كل رقم يعني نقطة مخصومة من مستأجر"
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

  const sections = [
    {
      title: "العقارات",
      note: "مراجعة الإعلانات ونشرها أو رفضها، ومشاهدة الفيديو والمعلم.",
      href: "/admin/properties",
      action: "فتح العقارات"
    },
    {
      title: "النقاط والإحالات",
      note: "اعتماد إيصالات الشحن، ومتابعة السحوبات وأرصدة المحافظ.",
      href: "/admin/wallets",
      action: "فتح النقاط"
    },
    {
      title: "قاموس البوت",
      note: "كلمات البحث والمناطق والردود المخصصة التي يفهمها البوت.",
      href: "/admin/dictionary",
      action: "فتح القاموس"
    },
    {
      title: "الإعدادات",
      note: "الأسعار والنسب ورقم الدفع، تُعدَّل من هنا بدل الكود.",
      href: "/admin/settings",
      action: "فتح الإعدادات"
    },
    {
      title: "المحاكي",
      note: "تجربة محادثة كاملة دون إرسال أي رسالة واتساب حقيقية.",
      href: "/admin/simulator",
      action: "فتح المحاكي"
    }
  ];

  return (
    <main className="admin-shell" dir="rtl">
      <header className="admin-hero">
        <div>
          <p className="eyebrow">Admin only</p>
          <h1>لوحة إدارة الديارة</h1>
          <p>
            {waitingCount > 0
              ? `عندك ${formatNumber(waitingCount)} عنصر ينتظر قرارك.`
              : "لا شيء ينتظر قرارك الآن."}
          </p>
        </div>
        <div className="hero-actions">
          <span className="status">MVP</span>
          <Link className="button" href="/admin/properties">
            مراجعة العقارات
          </Link>
        </div>
      </header>

      <section className="dashboard-grid">
        <article className="panel priority-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">يحتاج قرارك</p>
              <h2>المهام اليدوية</h2>
            </div>
          </div>

          {reviewItems.map((item) => (
            <div className="review-item" key={item.title}>
              <div>
                <strong>{formatNumber(item.value)}</strong>
                <span>{item.title}</span>
                <span>{item.note}</span>
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
              <p className="eyebrow">تلقائي</p>
              <h2>ما لا يحتاج تدخلك</h2>
            </div>
          </div>
          <p>هذه الخطوات صار البوت ينفذها وحده، ولا تنتظر أي موافقة منك:</p>
          <div className="chips">
            <span>تسليم رقم المؤجر بعد خصم النقطة</span>
            <span>إرسال الرقم تلقائيًا بعد اعتماد الشحن</span>
            <span>إشعار المؤجر بقبول إعلانه أو رفضه</span>
            <span>إلغاء مسودة الإعلان المهملة بعد ساعة</span>
          </div>
        </article>
      </section>

      <section className="stats-grid" aria-label="إحصائيات المنصة">
        {cards.map((card) => (
          <article className="metric-card" key={card.title}>
            <span>{card.title}</span>
            <strong>{formatNumber(card.value)}</strong>
            <p>{card.note}</p>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">الأقسام</p>
            <h2>كل صفحات الإدارة</h2>
          </div>
        </div>
        <div className="grid">
          {sections.map((section) => (
            <article className="metric-card" key={section.title}>
              <span>{section.title}</span>
              <p>{section.note}</p>
              <Link className="button secondary" href={section.href}>
                {section.action}
              </Link>
            </article>
          ))}
        </div>
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
          <span>تُخصم نقطة من رصيد المستأجر</span>
          <span>يصله رقم المؤجر فورًا</span>
        </div>
        <div className="panel-header" style={{ marginTop: 22 }}>
          <div>
            <p className="eyebrow">تدفق النقاط</p>
            <h2>كيف يشحن المستخدم رصيده</h2>
          </div>
        </div>
        <div className="flow-steps">
          <span>ينفد رصيد المستأجر</span>
          <span>يحوّل المبلغ لرقم الدفع</span>
          <span>يرسل صورة الإيصال للبوت</span>
          <span>الإدارة تعتمد الشحن</span>
          <span>النقاط تُضاف ويكمل طلبه تلقائيًا</span>
        </div>
      </section>
    </main>
  );
}
