import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const pageSize = 1000;

/**
 * The tables worth reading, with the sheet name each gets.
 *
 * Not every table: a workbook of eighteen sheets including conversation logs is harder to use than
 * one of eight. The full set is in the JSON download, which is the one for restoring anyway.
 */
const sheets: Array<{ table: string; name: string }> = [
  { table: "properties", name: "العقارات" },
  { table: "users", name: "المستخدمون" },
  { table: "user_wallets", name: "الأرصدة" },
  { table: "credit_transactions", name: "الحركات المالية" },
  { table: "credit_topups", name: "طلبات الشحن" },
  { table: "withdrawal_requests", name: "طلبات السحب" },
  { table: "contact_requests", name: "طلبات التواصل" },
  { table: "notification_log", name: "سجل الإشعارات" }
];

function cell(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  // Nested columns have no flat form, so they go in as text rather than [object Object].
  return typeof value === "object" ? JSON.stringify(value) : (value as string | number | boolean);
}

export async function GET() {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "قاعدة البيانات غير مربوطة." }, { status: 400 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  for (const { table, name } of sheets) {
    const rows: Array<Record<string, unknown>> = [];

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase.from(table).select("*").range(from, from + pageSize - 1);

      if (error) {
        break;
      }

      rows.push(...((data ?? []) as Array<Record<string, unknown>>));

      if ((data ?? []).length < pageSize) {
        break;
      }
    }

    const sheet = workbook.addWorksheet(name, { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });

    if (rows.length === 0) {
      sheet.addRow(["لا توجد بيانات"]);
      continue;
    }

    // Union of keys, not the first row's: a column that is null in row one still gets a header.
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];

    sheet.columns = headers.map((header) => ({ header, key: header, width: Math.min(Math.max(header.length + 4, 12), 40) }));
    sheet.getRow(1).font = { bold: true };

    for (const row of rows) {
      // Phone numbers are written as text so Excel does not render them in scientific notation.
      sheet.addRow(Object.fromEntries(headers.map((header) => [header, cell(row[header])])));
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="deyara-${stamp}.xlsx"`,
      "Cache-Control": "no-store"
    }
  });
}
