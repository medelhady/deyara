import Link from "next/link";
import { loadDashboardStats } from "@/lib/dashboard-stats";
import { DashboardLive } from "./DashboardLive";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Grouped rather than listed: nine identical cards in a row is a wall to scan, and these three
// groups are how the work actually splits -- the daily queue, the money, and the machinery.
const groups = [
  {
    title: "العمل اليومي",
    note: "ما تفتحه كل يوم",
    links: [
      {
        icon: "🏠",
        title: "العقارات",
        note: "مراجعة الإعلانات ونشرها أو رفضها، مع الفيديو والمعلم.",
        href: "/admin/properties"
      },
      {
        icon: "💬",
        title: "المحادثات",
        note: "كل ما دار بين البوت وأي رقم، كما وصل المستخدم تمامًا.",
        href: "/admin/conversations"
      },
      {
        icon: "👥",
        title: "المستخدمون",
        note: "من تحدث مع البوت، وإضافة رصيد يدويًا، وإيقاف أي رقم.",
        href: "/admin/users"
      }
    ]
  },
  {
    title: "المال والتسويق",
    note: "النقاط والعمولات",
    links: [
      {
        icon: "💳",
        title: "النقاط والإحالات",
        note: "اعتماد إيصالات الشحن، ومتابعة السحوبات وأرصدة المحافظ.",
        href: "/admin/wallets"
      },
      {
        icon: "⚙️",
        title: "الإعدادات",
        note: "الأسعار والنسب ورقم الدفع وتنبيهات الإدارة.",
        href: "/admin/settings"
      }
    ]
  },
  {
    title: "النظام",
    note: "المتابعة والصيانة",
    links: [
      {
        icon: "🔔",
        title: "سجل الإشعارات",
        note: "كل رسالة أرسلها النظام، وهل وصلت أم رفضها واتساب ولماذا.",
        href: "/admin/notifications"
      },
      {
        icon: "🔑",
        title: "حسابات الدخول",
        note: "من يفتح هذه اللوحة، برقم هاتفه ورقمه السري.",
        href: "/admin/accounts"
      },
      {
        icon: "📖",
        title: "قاموس البوت",
        note: "كلمات البحث والمناطق والردود المخصصة التي يفهمها البوت.",
        href: "/admin/dictionary"
      },
      {
        icon: "🧪",
        title: "المحاكي",
        note: "تجربة محادثة كاملة دون إرسال أي رسالة واتساب حقيقية.",
        href: "/admin/simulator"
      }
    ]
  }
];

const automatic = [
  "تسليم رقم المؤجر بعد خصم النقطة",
  "إرسال الرقم تلقائيًا بعد اعتماد الشحن",
  "إشعار المؤجر بقبول إعلانه أو رفضه",
  "إلغاء مسودة الإعلان المهملة بعد ساعة",
  "تنبيه المستأجرين عند تأجير الدار"
];

const flows = [
  {
    title: "كيف تمشي العملية داخل واتساب",
    steps: [
      "المؤجر يرسل العقار والفيديو",
      "الإدارة توافق على النشر",
      "المستأجر يبحث ويشاهد الفيديو",
      "تُخصم نقطة من رصيده",
      "يصله رقم المؤجر فورًا"
    ]
  },
  {
    title: "كيف يشحن المستخدم رصيده",
    steps: [
      "ينفد رصيد المستأجر",
      "يحوّل المبلغ لرقم الدفع",
      "يرسل صورة الإيصال للبوت",
      "الإدارة تعتمد الشحن",
      "النقاط تُضاف ويكمل طلبه تلقائيًا"
    ]
  }
];

export default async function AdminPage() {
  const stats = await loadDashboardStats();

  return (
    <main className="admin-shell dash" dir="rtl">
      <DashboardLive initial={stats} />

      <section className="dash-section" aria-label="أقسام اللوحة">
        <div className="dash-section-head">
          <h2>الأقسام</h2>
        </div>

        {groups.map((group) => (
          <div className="dash-group" key={group.title}>
            <div className="dash-group-head">
              <h3>{group.title}</h3>
              <span>{group.note}</span>
            </div>
            <div className="dash-links">
              {group.links.map((link) => (
                <Link className="dash-link" href={link.href} key={link.href}>
                  <span className="dash-link-icon" aria-hidden="true">
                    {link.icon}
                  </span>
                  <strong>{link.title}</strong>
                  <p>{link.note}</p>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="dash-section" aria-label="ما لا يحتاج تدخلك">
        <div className="dash-section-head">
          <h2>يمشي بدونك</h2>
        </div>
        <div className="dash-auto">
          {automatic.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </section>

      {/* Reference, not a daily read: folded away so it stops competing with the queue above. */}
      <details className="dash-details">
        <summary>كيف يعمل النظام خطوة بخطوة</summary>
        {flows.map((flow) => (
          <div key={flow.title}>
            <h3>{flow.title}</h3>
            <ol className="dash-flow">
              {flow.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        ))}
      </details>
    </main>
  );
}
