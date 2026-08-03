import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ wallets: [], withdrawals: [], mode: "mock" });
  }

  const [{ data: wallets, error: walletsError }, { data: withdrawals, error: withdrawalsError }] = await Promise.all([
    supabase
      .from("user_wallets")
      .select("*")
      .order("commission_points", { ascending: false })
      .limit(100),
    supabase
      .from("withdrawal_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100)
  ]);

  if (walletsError) {
    return NextResponse.json({ error: walletsError.message }, { status: 500 });
  }

  if (withdrawalsError) {
    return NextResponse.json({ error: withdrawalsError.message }, { status: 500 });
  }

  return NextResponse.json(
    { wallets: wallets ?? [], withdrawals: withdrawals ?? [] },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
      }
    }
  );
}
