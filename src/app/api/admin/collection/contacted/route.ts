import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Marks or unmarks a person as spoken to.
 *
 * A dashboard reply sets this on its own, so this is for the calls made elsewhere -- which is most
 * of them once the 24-hour window has closed and the only route left is the admin's own phone.
 *
 * Keyed on the person, not the entry: someone who registered twice was contacted once.
 */
export async function POST(request: Request) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "قاعدة البيانات غير مربوطة." }, { status: 400 });
  }

  const body = (await request.json()) as { phone?: string; contacted?: boolean };
  const phone = String(body.phone ?? "").trim();

  if (!phone) {
    return NextResponse.json({ error: "لم تحدد رقمًا." }, { status: 400 });
  }

  const { error } = await supabase.from("users").upsert(
    { phone, contacted_at: body.contacted === false ? null : new Date().toISOString() },
    { onConflict: "phone" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
