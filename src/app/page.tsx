import Link from "next/link";

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">WhatsApp-first real estate</p>
        <h1>منصة عقارية تعمل من واتساب، ولوحة الإدارة فقط للفريق.</h1>
        <p>
          النسخة الأولى تستقبل طلبات المؤجرين والمستأجرين، تخفي الأرقام، وتحوّل النشر
          وطلبات التواصل إلى موافقة الإدارة.
        </p>
        <Link className="button" href="/admin">
          فتح لوحة الإدارة
        </Link>
      </section>
    </main>
  );
}
