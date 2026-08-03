import Link from "next/link";
import { DictionaryClient } from "./DictionaryClient";

export const dynamic = "force-dynamic";

export default function DictionaryPage() {
  return (
    <main className="admin-shell" dir="rtl">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Bot dictionary</p>
          <h1>قاموس البوت</h1>
        </div>
        <Link className="button secondary" href="/admin">
          رجوع
        </Link>
      </header>
      <DictionaryClient />
    </main>
  );
}
