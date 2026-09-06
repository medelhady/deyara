import { listCollectionEntries } from "@/lib/collection-entries";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The sheet to take into a meeting with an agency, in the shape Excel opens. */
export async function GET() {
  const entries = await listCollectionEntries();
  const rows = entries.map((entry) => ({
    الجهة: entry.side === "owner" ? "مؤجر" : "مستأجر",
    المقاطعة: entry.area,
    السعر: entry.price ?? "",
    الغرف: entry.rooms ?? "",
    المواصفات: entry.specs ?? "",
    الرقم: entry.phone.replace("whatsapp:", ""),
    المصدر: entry.addedByAdmin ? "إدخال يدوي" : "البوت",
    التاريخ: entry.createdAt
  }));

  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="deyara-demand-${stamp}.csv"`,
      "Cache-Control": "no-store"
    }
  });
}
