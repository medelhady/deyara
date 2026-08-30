/**
 * Writes every table to a timestamped folder of JSON files: `npm run backup`.
 *
 * Uses the Supabase service key the app already has, so it needs nothing installed beyond what the
 * project uses. Data only -- the schema lives in supabase/*.sql in git, so those two together are a
 * full rebuild.
 *
 * What it does NOT cover: files in Supabase Storage, meaning listing videos and payment receipts.
 * Those are copies of what WhatsApp sent and cannot be recovered from here.
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const tables = [
  "app_settings",
  "bot_dictionary",
  "bot_messages",
  "contact_requests",
  "conversation_states",
  "conversations",
  "credit_topups",
  "credit_transactions",
  "dashboard_accounts",
  "notification_log",
  "payments",
  "places",
  "properties",
  "property_media",
  "search_requests",
  "user_wallets",
  "users",
  "withdrawal_requests"
];

/** Supabase caps a single select, so rows are pulled in pages until a short page arrives. */
const pageSize = 1000;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Copy them from Vercel into .env.local, or set them for this command only."
    );
    process.exit(1);
  }

  const client = createClient(url, key);

  // Defined here rather than taking the client as a parameter: naming that client's type means
  // spelling out generics the library infers perfectly well on its own.
  const dumpTable = async (table: string) => {
    const rows: unknown[] = [];

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await client.from(table).select("*").range(from, from + pageSize - 1);

      if (error) {
        return { rows, error: error.message };
      }

      rows.push(...(data ?? []));

      if ((data ?? []).length < pageSize) {
        return { rows, error: null };
      }
    }
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = join("backups", stamp);

  mkdirSync(dir, { recursive: true });

  let total = 0;
  let failed = 0;

  for (const table of tables) {
    const { rows, error } = await dumpTable(table);

    if (error) {
      failed += 1;
      console.log(`FAIL  ${table.padEnd(22)} ${error}`);
      continue;
    }

    writeFileSync(join(dir, `${table}.json`), JSON.stringify(rows, null, 2), "utf8");
    total += rows.length;
    console.log(`ok    ${table.padEnd(22)} ${rows.length} صف`);
  }

  console.log(`\nالمجلد: ${dir}`);
  console.log(`${total} صف من ${tables.length - failed} جدول.`);

  if (failed > 0) {
    console.log(`\n${failed} جدول لم يُنسخ. المفقود منها غير محفوظ.`);
    process.exit(1);
  }

  console.log("\n⚠️ ملفات التخزين (فيديوهات العقارات وصور الإيصالات) ليست ضمن هذه النسخة.");
}

void main();
