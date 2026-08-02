import Link from "next/link";
import { SimulatorClient } from "./SimulatorClient";

export default function SimulatorPage() {
  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Mock mode</p>
          <h1>اختبار محادثات واتساب</h1>
        </div>
        <Link className="button secondary" href="/admin">
          رجوع
        </Link>
      </header>
      <SimulatorClient />
    </main>
  );
}
