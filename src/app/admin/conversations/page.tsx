import Link from "next/link";
import { ConversationsClient } from "./ConversationsClient";

export const dynamic = "force-dynamic";

export default function ConversationsPage() {
  return (
    <main className="admin-shell" dir="rtl">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Conversations</p>
          <h1>محادثات البوت</h1>
        </div>
        <Link className="button secondary" href="/admin">
          رجوع
        </Link>
      </header>
      <ConversationsClient />
    </main>
  );
}
