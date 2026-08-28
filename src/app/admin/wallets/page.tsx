import Link from "next/link";
import { WalletsClient } from "./WalletsClient";

export const dynamic = "force-dynamic";

export default function WalletsPage() {
  return (
    <main className="admin-shell" dir="rtl">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Wallets</p>
          <h1>الأرصدة والإحالات</h1>
        </div>
        <Link className="button secondary" href="/admin">
          رجوع
        </Link>
      </header>
      <WalletsClient />
    </main>
  );
}
