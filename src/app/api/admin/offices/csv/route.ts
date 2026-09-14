import { listOffices } from "@/lib/offices";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The call list, in the shape Excel opens. */
export async function GET() {
  const { offices } = await listOffices();
  const rows = offices.map((office) => ({
    المكتب: office.name,
    الأرقام: office.phones.join(" / "),
    المنصة: office.platform ?? "",
    المنطقة: office.area ?? "",
    الملاحظة: office.note ?? "",
    التاريخ: office.createdAt
  }));

  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="deyara-offices-${stamp}.csv"`,
      "Cache-Control": "no-store"
    }
  });
}
