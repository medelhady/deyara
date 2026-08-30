import Link from "next/link";

export const dynamic = "force-dynamic";

export default function BackupPage() {
  return (
    <main className="admin-shell" dir="rtl">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Backup</p>
          <h1>نسخة احتياطية</h1>
        </div>
        <Link className="button secondary" href="/admin">
          رجوع
        </Link>
      </header>

      <section className="panel">
        <p>
          يحمّل كل بيانات النظام في ملف واحد: العقارات، المستخدمون، الأرصدة، الحركات المالية،
          الإعدادات، المحادثات. احفظه في مكان آمن خارج جهازك.
        </p>

        <p>
          خذ نسخة <strong>قبل أي حذف جماعي</strong>، وواحدة بعد كل تغيير كبير. هي طريقتك الوحيدة
          للرجوع إن مُسح شيء بالخطأ.
        </p>

        {/* A plain link, not fetch(): the browser handles the download and a large file never has to
            sit in the page's memory first. */}
        <p>
          <a className="button" href="/api/admin/backup">
            تحميل النسخة الآن
          </a>
        </p>

        <p className="amount-note">
          قد يستغرق التحميل بضع ثوانٍ. الملف بصيغة JSON، ويحمل تاريخ أخذه في اسمه.
        </p>

        <div className="notices-warning">
          ⚠️ لا تشمل النسخة ملفات التخزين — فيديوهات العقارات وصور الإيصالات. هي نسخ مما أرسله
          واتساب، ولا يمكن استرجاعها من هذا الملف.
        </div>
      </section>
    </main>
  );
}
