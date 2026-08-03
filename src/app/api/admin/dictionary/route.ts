import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const categories = ["greeting", "intro", "renter_search", "owner_listing", "area"];

export async function GET() {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ entries: [] });
  }

  const { data, error } = await supabase
    .from("bot_dictionary")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entries: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });
  }

  const body = await request.json();
  const category = String(body.category ?? "");
  const phrase = String(body.phrase ?? "").trim();
  const adminNote = String(body.admin_note ?? "").trim() || null;

  if (!categories.includes(category) || !phrase) {
    return NextResponse.json({ error: "Category and phrase are required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("bot_dictionary")
    .insert({
      category,
      phrase,
      admin_note: adminNote,
      active: true
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entry: data });
}
