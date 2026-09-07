import Link from "next/link";
import { CampaignsClient } from "./CampaignsClient";

export const dynamic = "force-dynamic";

export default function CampaignsPage() {
  return (
    <main className="admin-shell" dir="rtl">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Campaigns</p>
          <h1>حملات الشركاء</h1>
        </div>
        <Link className="button secondary" href="/admin">
          رجوع
        </Link>
      </header>

      <CampaignsClient />
    </main>
  );
}
