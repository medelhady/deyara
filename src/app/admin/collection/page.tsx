import Link from "next/link";
import { CollectionClient } from "./CollectionClient";

export const dynamic = "force-dynamic";

export default function CollectionPage() {
  return (
    <main className="admin-shell" dir="rtl">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Demand</p>
          <h1>الطلبات والعروض</h1>
        </div>
        <Link className="button secondary" href="/admin">
          رجوع
        </Link>
      </header>

      <CollectionClient />
    </main>
  );
}
