import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ wallets: [], withdrawals: [], mode: "mock" });
  }

  const [
    { data: wallets, error: walletsError },
    { data: withdrawals, error: withdrawalsError },
    { data: topups, error: topupsError }
  ] = await Promise.all([
    supabase
      .from("user_wallets")
      .select("*")
      .order("commission_points", { ascending: false })
      .limit(100),
    supabase
      .from("withdrawal_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("credit_topups")
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

  if (topupsError) {
    return NextResponse.json({ error: topupsError.message }, { status: 500 });
  }

  const referralCounts = new Map<string, number>();

  for (const wallet of wallets ?? []) {
    const referrer = wallet.referred_by_phone as string | null;
    if (referrer) {
      referralCounts.set(referrer, (referralCounts.get(referrer) ?? 0) + 1);
    }
  }

  const enrichedWallets = (wallets ?? []).map((wallet) => ({
    ...wallet,
    referrals_count: referralCounts.get(wallet.phone as string) ?? 0
  }));

  return NextResponse.json(
    { wallets: enrichedWallets, withdrawals: withdrawals ?? [], topups: topups ?? [] },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
      }
    }
  );
}
