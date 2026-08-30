import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { planPropertyDeletion, propertyLabel, type DeletionOutcome } from "@/lib/property-delete";

export const dynamic = "force-dynamic";

/**
 * Deletes several listings, one report line each.
 *
 * The guard is the same one the single delete applies, and for the same reason: a contact request is
 * a renter who paid for this listing's owner number, so a listing anyone asked about is a paid record
 * rather than leftover test data. Applying it here too means selecting fifty rows cannot quietly do
 * something selecting them one at a time would have refused.
 *
 * The counting is batched rather than a query per listing -- clearing out a test database means
 * dozens of ids in one request, and that is dozens of round trips saved.
 */
export async function POST(request: Request) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "قاعدة البيانات غير مربوطة." }, { status: 400 });
  }

  const body = (await request.json()) as { ids?: string[] };
  const ids = [...new Set((body.ids ?? []).map((id) => String(id)).filter(Boolean))];

  if (ids.length === 0) {
    return NextResponse.json({ error: "لم تحدد أي إعلان." }, { status: 400 });
  }

  const [{ data: properties }, { data: contacts }] = await Promise.all([
    supabase.from("properties").select("id,property_code").in("id", ids),
    supabase.from("contact_requests").select("property_id").in("property_id", ids)
  ]);

  const found = (properties ?? []).map((property) => ({
    id: String(property.id),
    property_code: property.property_code as string | null
  }));

  const { deletable, refused } = planPropertyDeletion(
    ids,
    found,
    (contacts ?? []).map((contact) => String((contact as { property_id: string }).property_id))
  );

  const results: DeletionOutcome[] = [...refused];

  if (deletable.length > 0) {
    const { error } = await supabase.from("properties").delete().in("id", deletable);

    for (const id of deletable) {
      const code = propertyLabel(id, found);

      results.push(error ? { id, code, deleted: false, reason: error.message } : { id, code, deleted: true });
    }
  }

  return NextResponse.json({ ok: true, results });
}
