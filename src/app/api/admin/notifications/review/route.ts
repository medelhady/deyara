import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Marks the failures an admin has looked at, so the dashboard banner can close.
 *
 * Reviewing is not the same as fixing, and the rows are kept exactly as they were -- this only
 * records that someone has seen them. A warning that cannot be acknowledged is one you learn to
 * scroll past, and the next real failure goes past with it.
 */
export async function POST() {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "قاعدة البيانات غير مربوطة." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("notification_log")
    .update({ reviewed_at: new Date().toISOString() })
    .eq("status", "failed")
    .is("reviewed_at", null)
    .select("id");

  if (error) {
    // The column arrives with supabase/add-notification-review.sql, and says so rather than failing
    // with a Postgres message an admin cannot act on.
    const missingColumn = error.message.includes("reviewed_at");

    return NextResponse.json(
      {
        error: missingColumn
          ? "شغّل أولًا ملف supabase/add-notification-review.sql في قاعدة البيانات، ثم أعد المحاولة."
          : error.message
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, reviewed: (data ?? []).length });
}
