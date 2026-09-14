import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Marks one request as read and taken down, or clears the mark.
 *
 * Kept on the entry: a number that registered a house and a search is two requests to read, and one
 * heart must not answer for both. Whether the person has been called is a different question, and is
 * kept on the person.
 */
export async function POST(request: Request) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "قاعدة البيانات غير مربوطة." }, { status: 400 });
  }

  const body = (await request.json()) as { id?: string; handled?: boolean };
  const id = String(body.id ?? "").trim();

  if (!id) {
    return NextResponse.json({ error: "لم تحدد الطلب." }, { status: 400 });
  }

  const { error } = await supabase
    .from("collection_entries")
    .update({ handled_at: body.handled === false ? null : new Date().toISOString() })
    .eq("id", id);

  if (error) {
    const missingColumn = (error.message ?? "").includes("handled_at");

    return NextResponse.json(
      {
        error: missingColumn
          ? "عمود handled_at غير موجود. شغّل ملف supabase/add-entry-handled.sql في محرر SQL بـ Supabase ثم أعد المحاولة."
          : error.message
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
