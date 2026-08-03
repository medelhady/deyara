export default function AdminLoginPage({
  searchParams
}: {
  searchParams?: { error?: string };
}) {
  return (
    <main className="admin-shell auth-shell" dir="rtl">
      <section className="panel auth-panel">
        <p className="eyebrow">Admin only</p>
        <h1>دخول الإدارة</h1>
        <p>أدخل مفتاح الإدارة لفتح لوحة العقارات وطلبات التواصل.</p>

        {searchParams?.error ? <p className="auth-error">المفتاح غير صحيح.</p> : null}

        <form action="/api/admin/login" method="post" className="auth-form">
          <label>
            مفتاح الإدارة
            <input name="token" type="password" autoComplete="current-password" required />
          </label>
          <button className="button" type="submit">
            دخول
          </button>
        </form>
      </section>
    </main>
  );
}
