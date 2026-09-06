import { NextResponse } from "next/server";
import { listCollectionEntries, saveCollectionEntry, summariseByArea } from "@/lib/collection-entries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Everything collected, plus the per-district counts that are the point of collecting it. */
export async function GET() {
  const entries = await listCollectionEntries();

  return NextResponse.json(
    { entries, byArea: summariseByArea(entries) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * One entry typed in by an admin.
 *
 * For the Facebook and TikTok comments already collected by hand: they are the same demand, and
 * leaving them in a comment thread means re-reading it every time someone asks what people want.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    side?: string;
    area?: string;
    phone?: string;
    price?: string;
    specs?: string;
  };

  const side = body.side === "owner" ? "owner" : "renter";
  const area = String(body.area ?? "").trim();
  const phone = String(body.phone ?? "").trim();

  if (!area) {
    return NextResponse.json({ error: "المقاطعة مطلوبة." }, { status: 400 });
  }

  if (!phone) {
    return NextResponse.json({ error: "الرقم مطلوب — بدونه لا يمكن مراسلته لاحقًا." }, { status: 400 });
  }

  const digits = String(body.price ?? "").replace(/\D/g, "");
  const result = await saveCollectionEntry({
    phone: phone.startsWith("whatsapp:") ? phone : `whatsapp:+${phone.replace(/\D/g, "")}`,
    side,
    area,
    price: digits ? Number(digits) : undefined,
    specs: String(body.specs ?? "").trim() || undefined,
    addedByAdmin: true
  });

  if (!result.saved) {
    return NextResponse.json({ error: result.error ?? "تعذر الحفظ." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
