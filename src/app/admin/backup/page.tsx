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

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">للقراءة والمحاسبة</p>
            <h2>تصدير جدول إلى إكسل</h2>
          </div>
        </div>

        <p>
          ملف JSON أعلاه للاسترجاع، وهذا للقراءة. ملف إكسل واحد فيه كل جدول في ورقة مستقلة:
          العقارات، المستخدمون، الأرصدة، الحركات المالية، طلبات الشحن والسحب والتواصل، وسجل
          الإشعارات.
        </p>

        <p>
          <a className="button" href="/api/admin/backup/excel">
            تحميل كل الجداول في ملف إكسل
          </a>
        </p>

        <details className="message-row">
          <summary>أو حمّل جدولًا واحدًا بصيغة CSV</summary>

          <div className="dash-auto">
            {[
              { table: "properties", label: "العقارات" },
              { table: "users", label: "المستخدمون" },
              { table: "user_wallets", label: "الأرصدة" },
              { table: "credit_transactions", label: "الحركات المالية" },
              { table: "credit_topups", label: "طلبات الشحن" },
              { table: "withdrawal_requests", label: "طلبات السحب" },
              { table: "contact_requests", label: "طلبات التواصل" },
              { table: "notification_log", label: "سجل الإشعارات" }
            ].map((item) => (
              <a key={item.table} href={`/api/admin/backup/csv?table=${item.table}`}>
                ⬇ {item.label}
              </a>
            ))}
          </div>
        </details>

        <p className="amount-note">
          للاسترجاع استخدم ملف JSON دائمًا: إكسل يغيّر شكل الأرقام والتواريخ، فلا يصلح لإعادة
          الإدخال.
        </p>
      </section>
    </main>
  );
}
