import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase/server";
import { getConversationState, setConversationState } from "@/lib/conversation/store";
import { fulfillPendingContactRequest, submitPropertyForReview } from "@/lib/conversation/engine";
import { getSettings } from "@/lib/settings";
import { metaWhatsAppProvider } from "@/lib/whatsapp/meta";

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

  const { data, error } = await supabase
    .from("credit_topups")
    .update({
      status: payload.status,
      updated_at: new Date().toISOString()
    })
    .eq("id", params.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (payload.status === "approved") {
    const { data: wallet, error: walletFetchError } = await supabase
      .from("user_wallets")
      .select("usage_points,referred_by_phone")
      .eq("phone", topup.phone)
      .maybeSingle();

    if (walletFetchError) {
      return NextResponse.json({ error: walletFetchError.message }, { status: 500 });
    }

    const currentPoints = Number(wallet?.usage_points ?? 0);
    const topupPoints = Number(payload.points ?? topup.points ?? 0);

    const { error: walletUpdateError } = await supabase
      .from("user_wallets")
      .update({
        usage_points: currentPoints + topupPoints
      })
      .eq("phone", topup.phone);

    if (walletUpdateError) {
      return NextResponse.json({ error: walletUpdateError.message }, { status: 500 });
    }

    const { error: ledgerError } = await supabase.from("credit_transactions").insert({
      phone: topup.phone,
      kind: "topup_approved",
      usage_points_delta: topupPoints,
      admin_note: "شحن رصيد مُعتمد من الإدارة"
    });

    if (ledgerError) {
      console.error("Failed to record the approved topup", ledgerError);
    }

    // The referral commission used to live only in an API route no page ever called, so the 30% the
    // bot promises was never actually paid.
    const referrerPhone = (wallet?.referred_by_phone as string | null) ?? null;

    if (referrerPhone) {
      const { referralCommissionPercent } = await getSettings();
      const commission = Math.floor((topupPoints * referralCommissionPercent) / 100);

      if (commission > 0) {
        const { data: referrerWallet } = await supabase
          .from("user_wallets")
          .select("commission_points")
          .eq("phone", referrerPhone)
          .maybeSingle();

        if (referrerWallet) {
          const { error: commissionError } = await supabase
            .from("user_wallets")
            .update({
              commission_points: Number(referrerWallet.commission_points ?? 0) + commission
            })
            .eq("phone", referrerPhone);

          if (commissionError) {
            console.error("Failed to pay the referral commission", commissionError);
          } else {
            await supabase.from("credit_transactions").insert({
              phone: referrerPhone,
              kind: "referral_commission",
              commission_points_delta: commission,
              related_phone: topup.phone,
              admin_note: `${referralCommissionPercent}% عمولة من شحن ${topupPoints} نقطة`
            });

            try {
              await metaWhatsAppProvider.sendText(
                referrerPhone,
                [
                  "📣 *عمولة تسويق جديدة*",
                  "",
                  `أضفنا لك *${commission} نقطة تسويق* من شحن أحد من دعوتهم.`,
                  "",
                  "📌 لمتابعة رصيدك اكتب: *رصيدي*"
                ].join("\n")
              );
            } catch (notifyError) {
              console.error("Failed to notify the referrer about their commission", notifyError);
            }
          }
        }
      }
    }

    // A draft that is still awaiting confirmation predates the move of the listing fee to approval
    // time. Submitting costs nothing now, so send it straight to review.
    const conversationState = await getConversationState(topup.phone);
    const draft = conversationState.draftProperty;

    if (draft?.awaitingConfirmation) {
      const submission = await submitPropertyForReview(topup.phone, draft);

      await setConversationState(topup.phone, {
        ...conversationState,
        draftProperty: undefined
      });

      if (submission.saved) {
        try {
          await metaWhatsAppProvider.sendText(
            topup.phone,
            "✅ تم إرسال إعلانك إلى الإدارة للمراجعة. سنخبرك عند الموافقة أو إذا احتاج الإعلان لتعديل."
          );
        } catch (notifyError) {
          console.error("Failed to notify owner about auto-submitted listing", notifyError);
        }
      }
    }

    const contactReply = await fulfillPendingContactRequest(topup.phone);

    if (contactReply) {
      try {
        await metaWhatsAppProvider.sendText(topup.phone, contactReply);
      } catch (notifyError) {
        console.error("Failed to send owner contact after approved topup", notifyError);
      }
    }
  }

  return NextResponse.json({ creditTopup: data });
}