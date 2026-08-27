import Link from "next/link";
import { BroadcastClient } from "./BroadcastClient";

export const dynamic = "force-dynamic";

export default function BroadcastPage() {
  return (
    <main className="admin-shell" dir="rtl">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Broadcast</p>
          <h1>رسالة جماعية</h1>
        </div>
        <Link className="button secondary" href="/admin">
          رجوع
        </Link>
      </header>
      <BroadcastClient />
    </main>
  );
}
