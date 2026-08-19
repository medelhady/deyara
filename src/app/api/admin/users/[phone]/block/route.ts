import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const blockSchema = z.object({
  blocked: z.boolean(),
  reason: z.string().max(300).optional()
});

export async function PATCH(request: Request, { params }: { params: { phone: string } }) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const payload = blockSchema.parse(await request.json());
  const phone = decodeURIComponent(params.phone);

  const { data, error } = await supabase
    .from("users")
    .update({
      blocked_at: payload.blocked ? new Date().toISOString() : null,
      blocked_reason: payload.blocked ? payload.reason?.trim() || null : null
    })
    .eq("phone", phone)
    .select("phone,blocked_at,blocked_reason")
    .single();

  if (error) {
    const missingColumn = error.message?.includes("blocked_at");

    return NextResponse.json(
      {
        error: missingColumn
          ? "عمود الحظر غير موجود في قاعدة البيانات. شغّل ملف supabase/add-user-blocking.sql في محرر SQL بـ Supabase ثم أعد المحاولة."
          : error.message
      },
      { status: missingColumn ? 400 : 500 }
    );
  }

  return NextResponse.json({ user: data });
}
