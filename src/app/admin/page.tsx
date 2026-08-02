import Link from "next/link";

const cards = [
  { title: "العقارات", value: "قيد الربط", note: "مراجعة ونشر وإخفاء العقارات" },
  { title: "طلبات التواصل", value: "قيد الربط", note: "رسوم، إيصالات، وموافقة قبل كشف الرقم" },
  { title: "المحادثات", value: "قيد الربط", note: "سجل واتساب كامل حسب رقم الهاتف" },
  { title: "المناطق والمعالم", value: "قيد الربط", note: "قاموس محلي لتحسين فهم الرسائل" }
];

export default function AdminPage() {
  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Admin only</p>
          <h1>لوحة إدارة المنصة العقارية</h1>
        </div>
        <span className="status">MVP</span>
      </header>

      <section className="grid">
        {cards.map((card) => (
          <article className="card" key={card.title}>
            <h2>{card.title}</h2>
            <strong>{card.value}</strong>
            <p>{card.note}</p>
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>تدفق الموافقة</h2>
        <ol>
          <li>المؤجر يرسل المقاطعة والسعر والمعلم القريب والفيديو عبر واتساب.</li>
          <li>العقار يدخل حالة انتظار مراجعة الإدارة.</li>
          <li>المستأجر يبحث ويرى النتائج بدون أرقام.</li>
          <li>طلب التواصل يحتاج رسومًا وإيصالًا وموافقة الإدارة.</li>
          <li>بعد الموافقة يظهر رقم المؤجر للمستأجر فقط.</li>
        </ol>
      </section>

      <section className="panel actions-panel">
        <h2>اختبار قبل ربط واتساب</h2>
        <p>استخدم المحاكي لتجربة رسائل المؤجر والمستأجر بدون دفع Twilio أو ربط رقم حقيقي.</p>
        <Link className="button" href="/admin/simulator">
          فتح المحاكي
        </Link>
        <Link className="button secondary" href="/admin/properties">
          مراجعة العقارات
        </Link>
      </section>
    </main>
  );
}
