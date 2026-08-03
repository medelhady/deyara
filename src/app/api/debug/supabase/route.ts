import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const hasUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({
      ok: false,
      hasUrl,
      hasServiceKey,
      error: "Supabase server client is not configured."
    });
  }

  const [propertiesResult, statesResult, usersResult] = await Promise.all([
    supabase.from("properties").select("id,property_code,status,area,price,landmark,created_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("conversation_states").select("phone,updated_at,state").order("updated_at", { ascending: false }).limit(5),
    supabase.from("users").select("phone,role,created_at").order("created_at", { ascending: false }).limit(5)
  ]);

  return NextResponse.json({
    ok: !propertiesResult.error && !statesResult.error && !usersResult.error,
    hasUrl,
    hasServiceKey,
    urlHost: process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : null,
    properties: {
      error: propertiesResult.error?.message ?? null,
      rows: propertiesResult.data ?? []
    },
    conversationStates: {
      error: statesResult.error?.message ?? null,
      rows: statesResult.data ?? []
    },
    users: {
      error: usersResult.error?.message ?? null,
      rows: usersResult.data ?? []
    }
  });
}
