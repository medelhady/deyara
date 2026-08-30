import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { backupTables } from "@/lib/backup";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const pageSize = 1000;

/** One table as CSV, for reading in Excel rather than for restoring. */
export async function GET(request: Request) {
  const table = new URL(request.url).searchParams.get("table") ?? "";

  // Checked against the known list, never interpolated: the table name comes from the query string.
  if (!backupTables.includes(table)) {
    return NextResponse.json({ error: "جدول غير معروف." }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "قاعدة البيانات غير مربوطة." }, { status: 400 });
  }

  const rows: Array<Record<string, unknown>> = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + pageSize - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    rows.push(...((data ?? []) as Array<Record<string, unknown>>));

    if ((data ?? []).length < pageSize) {
      break;
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${table}-${stamp}.csv"`,
      "Cache-Control": "no-store"
    }
  });
}
