import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });
  }

  const body = await request.json();
  const status = String(body.status ?? "");
  const points = Number(body.points ?? 0);
  const adminNote = String(body.admin_note ?? "").trim() || null;

  if (!["approved", "rejected"].includes(status)) {
    return NextResponse.json({ error: "Invalid topup status." }, { status: 400 });
  }

  if (status === "approved" && (!Number.isFinite(points) || points <= 0)) {
    return NextResponse.json({ error: "Points must be greater than zero." }, { status: 400 });
  }

  const { data: topup, error: topupError } = await supabase
    .from("credit_topups")
    .select("*")
    .eq("id", params.id)
    .single();

  if (topupError || !topup) {
    return NextResponse.json({ error: topupError?.message ?? "Topup not found." }, { status: 404 });
  }

  if (topup.status === "approved") {
    return NextResponse.json({ error: "Topup already approved." }, { status: 400 });
  }

  if (status === "approved") {
    const { data: wallet, error: walletError } = await supabase
      .from("user_wallets")
      .select("*")
      .eq("phone", topup.phone)
      .single();

    if (walletError || !wallet) {
      return NextResponse.json({ error: walletError?.message ?? "Wallet not found." }, { status: 404 });
    }

    const { error: walletUpdateError } = await supabase
      .from("user_wallets")
      .update({
        usage_points: Number(wallet.usage_points ?? 0) + points
      })
      .eq("phone", topup.phone);

    if (walletUpdateError) {
      return NextResponse.json({ error: walletUpdateError.message }, { status: 500 });
    }

    await supabase.from("credit_transactions").insert({
      phone: topup.phone,
      kind: "topup",
      usage_points_delta: points,
      admin_note: adminNote
    });

    if (wallet.referred_by_phone) {
      const commission = Math.floor(points * 0.3);

      if (commission > 0) {
        const { data: referrerWallet } = await supabase
          .from("user_wallets")
          .select("*")
          .eq("phone", wallet.referred_by_phone)
          .maybeSingle();

        if (referrerWallet) {
          await supabase
            .from("user_wallets")
            .update({
              commission_points: Number(referrerWallet.commission_points ?? 0) + commission
            })
            .eq("phone", wallet.referred_by_phone);

          await supabase.from("credit_transactions").insert({
            phone: wallet.referred_by_phone,
            kind: "referral_commission",
            commission_points_delta: commission,
            related_phone: topup.phone,
            admin_note: `30% عمولة من شحن ${points} نقطة`
          });
        }
      }
    }
  }

  const { data, error } = await supabase
    .from("credit_topups")
    .update({
      status,
      points: status === "approved" ? points : topup.points,
      admin_note: adminNote
    })
    .eq("id", params.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ topup: data });
}
