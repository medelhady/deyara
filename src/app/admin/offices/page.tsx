import Link from "next/link";
import { OfficesClient } from "./OfficesClient";

export const dynamic = "force-dynamic";

export default function OfficesPage() {
  return (
    <main className="admin-shell" dir="rtl">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Offices</p>
          <h1>المكاتب العقارية</h1>
        </div>
        <Link className="button secondary" href="/admin">
          رجوع
        </Link>
      </header>

      <OfficesClient />
    </main>
  );
}
