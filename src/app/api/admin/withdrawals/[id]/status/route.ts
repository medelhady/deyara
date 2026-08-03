import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const allowedStatuses = ["approved", "rejected", "paid"];

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
  const adminNote = String(body.admin_note ?? "").trim() || null;

  if (!allowedStatuses.includes(status)) {
    return NextResponse.json({ error: "Invalid withdrawal status." }, { status: 400 });
  }

  const { data: withdrawal, error: withdrawalError } = await supabase
    .from("withdrawal_requests")
    .select("*")
    .eq("id", params.id)
    .single();

  if (withdrawalError || !withdrawal) {
    return NextResponse.json({ error: withdrawalError?.message ?? "Withdrawal not found." }, { status: 404 });
  }

  if (status === "paid" && withdrawal.status !== "paid") {
    const { data: wallet, error: walletError } = await supabase
      .from("user_wallets")
      .select("*")
      .eq("phone", withdrawal.phone)
      .single();

    if (walletError || !wallet) {
      return NextResponse.json({ error: walletError?.message ?? "Wallet not found." }, { status: 404 });
    }

    const currentCommission = Number(wallet.commission_points ?? 0);
    const points = Number(withdrawal.points ?? 0);

    if (currentCommission < points) {
      return NextResponse.json({ error: "Insufficient commission points." }, { status: 400 });
    }

    const { error: walletUpdateError } = await supabase
      .from("user_wallets")
      .update({
        commission_points: currentCommission - points,
        withdrawn_commission_points: Number(wallet.withdrawn_commission_points ?? 0) + points
      })
      .eq("phone", withdrawal.phone);

    if (walletUpdateError) {
      return NextResponse.json({ error: walletUpdateError.message }, { status: 500 });
    }

    await supabase.from("credit_transactions").insert({
      phone: withdrawal.phone,
      kind: "withdrawal",
      commission_points_delta: -points,
      admin_note: adminNote
    });
  }

  const { data, error } = await supabase
    .from("withdrawal_requests")
    .update({
      status,
      admin_note: adminNote
    })
    .eq("id", params.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ withdrawal: data });
}
