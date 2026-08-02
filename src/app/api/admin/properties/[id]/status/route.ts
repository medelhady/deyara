import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase/server";

const statusSchema = z.object({
  status: z.enum(["active", "rejected", "hidden", "rented"]),
  admin_note: z.string().optional()
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const payload = statusSchema.parse(await request.json());
  const { data, error } = await supabase
    .from("properties")
    .update({
      status: payload.status,
      admin_note: payload.admin_note,
      updated_at: new Date().toISOString()
    })
    .eq("id", params.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ property: data });
}
