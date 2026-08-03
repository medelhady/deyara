import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({
      contactRequests: [],
      mode: "mock",
      message: "Add Supabase environment variables to read live contact requests."
    });
  }

  const { data, error } = await supabase
    .from("contact_requests")
    .select("*, properties(property_code, type, area, price, landmark), payments(id, receipt_image_url, status, created_at)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { contactRequests: data },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
      }
    }
  );
}
