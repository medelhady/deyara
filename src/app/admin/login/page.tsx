export const dynamic = "force-dynamic";

export default function AdminLoginPage({
  searchParams
}: {
  searchParams?: { error?: string; phone?: string };
}) {
  return (
    <main className="admin-shell auth-shell" dir="rtl">
      <section className="panel auth-panel">
        <p className="eyebrow">Admin only</p>
        <h1>دخول الإدارة</h1>
        <p>أدخل رقم هاتفك والرقم السري لفتح لوحة العقارات وطلبات التواصل.</p>

        {searchParams?.error ? <p className="auth-error">{searchParams.error}</p> : null}

        <form action="/api/admin/login" method="post" className="auth-form">
          <label>
            رقم الهاتف
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              dir="ltr"
              placeholder="22245678901"
              defaultValue={searchParams?.phone ?? ""}
              autoComplete="username"
              required
            />
          </label>
          <label>
            الرقم السري
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button className="button" type="submit">
            دخول
          </button>
        </form>
      </section>
    </main>
  );
}
