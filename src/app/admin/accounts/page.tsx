import Link from "next/link";
import { AccountsClient } from "./AccountsClient";

export const dynamic = "force-dynamic";

export default function AccountsPage() {
  return (
    <main className="admin-shell" dir="rtl">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Accounts</p>
          <h1>حسابات الدخول</h1>
        </div>
        <Link className="button secondary" href="/admin">
          رجوع
        </Link>
      </header>
      <AccountsClient />
    </main>
  );
}
