import Link from "next/link";
import { PropertiesClient } from "./PropertiesClient";

export default function PropertiesPage() {
  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Review queue</p>
          <h1>مراجعة العقارات</h1>
        </div>
        <Link className="button secondary" href="/admin">
          رجوع
        </Link>
      </header>
      <PropertiesClient />
    </main>
  );
}
