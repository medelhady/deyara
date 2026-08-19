import Link from "next/link";
import { UsersClient } from "./UsersClient";

export const dynamic = "force-dynamic";

export default function UsersPage() {
  return (
    <main className="admin-shell" dir="rtl">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Users</p>
          <h1>إدارة المستخدمين</h1>
        </div>
        <Link className="button secondary" href="/admin">
          رجوع
        </Link>
      </header>
      <UsersClient />
    </main>
  );
}
