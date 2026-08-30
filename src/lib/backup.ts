import { getServiceSupabase } from "@/lib/supabase/server";

/**
 * Every table worth keeping. Listed rather than discovered, so a new table is a deliberate decision
 * to back up rather than something silently missing from the dump.
 */
export const backupTables = [
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

export type Backup = {
  takenAt: string;
  tables: Record<string, unknown[]>;
  failed: Record<string, string>;
};

export async function buildBackup(): Promise<Backup> {
  const supabase = getServiceSupabase();
  const tables: Record<string, unknown[]> = {};
  const failed: Record<string, string> = {};

  if (!supabase) {
    return { takenAt: new Date().toISOString(), tables, failed: { _: "قاعدة البيانات غير مربوطة." } };
  }

  for (const table of backupTables) {
    const rows: unknown[] = [];
    let error: string | null = null;

    for (let from = 0; ; from += pageSize) {
      const page = await supabase.from(table).select("*").range(from, from + pageSize - 1);

      if (page.error) {
        error = page.error.message;
        break;
      }

      rows.push(...(page.data ?? []));

      if ((page.data ?? []).length < pageSize) {
        break;
      }
    }

    if (error) {
      // Recorded rather than thrown: one missing table should not cost the admin the other
      // seventeen, and a dump that quietly skipped something is worse than one that says so.
      failed[table] = error;
      continue;
    }

    tables[table] = rows;
  }

  return { takenAt: new Date().toISOString(), tables, failed };
}
