import Link from "next/link";
import { NotificationsClient } from "./NotificationsClient";

export const dynamic = "force-dynamic";

export default function NotificationsPage() {
  return (
    <main className="admin-shell" dir="rtl">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Notifications</p>
          <h1>سجل الإشعارات</h1>
        </div>
        <Link className="button secondary" href="/admin">
          رجوع
        </Link>
      </header>
      <NotificationsClient />
    </main>
  );
}
