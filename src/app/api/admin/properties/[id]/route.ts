import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Deletes a listing.
 *
 * property_media cascades away with it. contact_requests does not, and that is the useful guard:
 * a contact request is a renter who paid a point for this listing's owner number, so a listing
 * anyone ever asked about is a paid record rather than leftover test data. The database would
 * refuse the delete regardless; checking first turns a foreign key error into a sentence.
 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "قاعدة البيانات غير مربوطة." }, { status: 400 });
  }

  const { data: property } = await supabase
    .from("properties")
    .select("id,property_code")
    .eq("id", params.id)
    .maybeSingle();

  if (!property) {
    return NextResponse.json({ error: "لم أجد هذا الإعلان." }, { status: 404 });
  }

  const { count } = await supabase
    .from("contact_requests")
    .select("id", { count: "exact", head: true })
    .eq("property_id", params.id);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `لا يمكن حذفه: ${count} مستأجر طلبوا رقم مالكه ودفعوا مقابله. أخفِ الإعلان بدل حذفه حتى يبقى سجل الدفع.`
      },
      { status: 400 }
    );
  }

  const { error } = await supabase.from("properties").delete().eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, code: property.property_code ?? String(property.id).slice(0, 8) });
}
