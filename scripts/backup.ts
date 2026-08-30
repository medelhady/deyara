/**
 * Writes the database to a timestamped folder of JSON files: `npm run backup`.
 *
 * The same dump the dashboard offers at /admin/backup, split one file per table. Use the dashboard
 * button unless you want the files separated; this one needs the Supabase keys in .env.local first.
 *
 * Data only. The schema lives in supabase/*.sql in git, so the two together rebuild the database.
 * Files in Supabase Storage -- listing videos and payment receipts -- are not covered.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildBackup } from "../src/lib/backup";

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.\n" +
        "The dashboard has a download button that needs no setup: /admin/backup"
    );
    process.exit(1);
  }

  const backup = await buildBackup();
  const dir = join("backups", backup.takenAt.replace(/[:.]/g, "-").slice(0, 19));

  mkdirSync(dir, { recursive: true });

  let total = 0;

  for (const [table, rows] of Object.entries(backup.tables)) {
    writeFileSync(join(dir, `${table}.json`), JSON.stringify(rows, null, 2), "utf8");
    total += rows.length;
    console.log(`ok    ${table.padEnd(22)} ${rows.length} صف`);
  }

  for (const [table, error] of Object.entries(backup.failed)) {
    console.log(`FAIL  ${table.padEnd(22)} ${error}`);
  }

  console.log(`\nالمجلد: ${dir}`);
  console.log(`${total} صف من ${Object.keys(backup.tables).length} جدول.`);

  if (Object.keys(backup.failed).length > 0) {
    console.log("\nبعض الجداول لم تُنسخ. المفقود منها غير محفوظ.");
    process.exit(1);
  }

  console.log("\n⚠️ ملفات التخزين (فيديوهات العقارات وصور الإيصالات) ليست ضمن هذه النسخة.");
}

void main();
