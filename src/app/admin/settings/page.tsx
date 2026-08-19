import Link from "next/link";
import { SettingsClient } from "./SettingsClient";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <main className="admin-shell" dir="rtl">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>إعدادات الديارة</h1>
        </div>
        <Link className="button secondary" href="/admin">
          رجوع
        </Link>
      </header>
      <SettingsClient />
    </main>
  );
}
