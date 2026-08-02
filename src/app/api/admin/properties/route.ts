import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({
      properties: [],
      mode: "mock",
      message: "Add Supabase environment variables to read live properties."
    });
  }

  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ properties: data });
}
