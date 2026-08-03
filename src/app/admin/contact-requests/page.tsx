import Link from "next/link";
import { ContactRequestsClient } from "./ContactRequestsClient";

export default function ContactRequestsPage() {
  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Contact requests</p>
          <h1>طلبات التواصل</h1>
        </div>
        <Link className="button secondary" href="/admin">
          رجوع
        </Link>
      </header>
      <ContactRequestsClient />
    </main>
  );
}
