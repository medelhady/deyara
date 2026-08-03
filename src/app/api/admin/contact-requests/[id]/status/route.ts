import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const statusSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  admin_note: z.string().optional()
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const payload = statusSchema.parse(await request.json());
  const { data, error } = await supabase
    .from("contact_requests")
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

  if (payload.status === "approved") {
    await supabase
      .from("payments")
      .update({
        status: "approved",
        updated_at: new Date().toISOString()
      })
      .eq("contact_request_id", params.id)
      .eq("status", "pending");
  }

  if (payload.status === "rejected") {
    await supabase
      .from("payments")
      .update({
        status: "rejected",
        updated_at: new Date().toISOString()
      })
      .eq("contact_request_id", params.id)
      .eq("status", "pending");
  }

  return NextResponse.json({ contactRequest: data });
}
