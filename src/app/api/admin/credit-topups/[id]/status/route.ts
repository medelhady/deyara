import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase/server";
import { creditApprovedTopup } from "@/lib/admin-actions";

export const dynamic = "force-dynamic";

const statusSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  points: z.number().int().positive().optional()
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const payload = statusSchema.parse(await request.json());

  const { data: topup, error: fetchError } = await supabase
    .from("credit_topups")
    .select("*")
    .eq("id", params.id)
    .single();

  if (fetchError || !topup) {
    return NextResponse.json({ error: fetchError?.message ?? "Topup not found." }, { status: 404 });
  }

  if (topup.status !== "pending") {
    return NextResponse.json({ error: "This request was already processed." }, { status: 400 });
  }

  const points = Number(payload.points ?? topup.points ?? 0);

  if (payload.status === "approved" && points <= 0) {
    return NextResponse.json({ error: "Points must be greater than zero." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("credit_topups")
    .update({
      status: payload.status,
      points: payload.status === "approved" ? points : topup.points,
      updated_at: new Date().toISOString()
    })
    .eq("id", params.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (payload.status === "approved") {
    const result = await creditApprovedTopup(topup.phone as string, points);

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 500 });
    }
  }

  return NextResponse.json({ creditTopup: data });
}
