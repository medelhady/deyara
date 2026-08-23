import Link from "next/link";
import { MessagesClient } from "./MessagesClient";

export const dynamic = "force-dynamic";

export default function MessagesPage() {
  return (
    <main className="admin-shell" dir="rtl">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Messages</p>
          <h1>رسائل البوت</h1>
        </div>
        <Link className="button secondary" href="/admin">
          رجوع
        </Link>
      </header>
      <MessagesClient />
    </main>
  );
}
