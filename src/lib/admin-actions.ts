import { getServiceSupabase } from "@/lib/supabase/server";
import { metaWhatsAppProvider } from "@/lib/whatsapp/meta";
import {
  formatListingApproval,
  fulfillPendingContactRequest,
  spendPointsForListing,
  submitPropertyForReview
} from "@/lib/conversation/engine";
import { getConversationState, setConversationState } from "@/lib/conversation/store";
import { getSettings } from "@/lib/settings";

export type PropertyStatus = "active" | "rejected" | "hidden" | "rented";

export type AdminActionResult =
  | { ok: true; message: string; data?: Record<string, unknown> }
  | { ok: false; message: string; reason?: "insufficient_points" | "not_found" | "unavailable" };

/**
 * The single place a listing changes status, shared by the dashboard and the WhatsApp commands so
 * the fee, the owner notification and the rules never drift apart.
 */
export async function setPropertyStatus(
  propertyId: string,
  status: PropertyStatus,
  adminNote?: string
): Promise<AdminActionResult> {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { ok: false, message: "قاعدة البيانات غير مربوطة.", reason: "unavailable" };
  }

  const { data: current, error: currentError } = await supabase
    .from("properties")
    .select("*")
    .eq("id", propertyId)
    .single();

  if (currentError || !current) {
    return { ok: false, message: currentError?.message ?? "لم أجد هذا الإعلان.", reason: "not_found" };
  }

  // Publishing is what costs points, and it must not go through on an empty wallet. Charge before
  // flipping the status so a failed payment cannot leave a listing live for free. Only the first
  // publication is charged: hidden and rented listings were already paid for.
  const chargesListingFee =
    status === "active" && (current.status === "pending_review" || current.status === "rejected");
  let spend: Awaited<ReturnType<typeof spendPointsForListing>> | null = null;

  if (chargesListingFee && current.owner_phone) {
    spend = await spendPointsForListing(current.owner_phone as string);

    if (!spend.ok) {
      try {
        await metaWhatsAppProvider.sendText(current.owner_phone as string, spend.reply);
      } catch (notifyError) {
        console.error("Failed to ask the owner to top up", notifyError);
      }

      return {
        ok: false,
        message: "رصيد المؤجر لا يكفي لنشر الإعلان. أرسلنا له طلب شحن، أعد المحاولة بعد الشحن.",
        reason: "insufficient_points"
      };
    }
  }

  const { data, error } = await supabase
    .from("properties")
    .update({
      status,
      admin_note: adminNote,
      updated_at: new Date().toISOString()
    })
    .eq("id", propertyId)
    .select("*")
    .single();

  if (error) {
    return { ok: false, message: error.message };
  }

  if (status === "active" && data.owner_phone) {
    try {
      await metaWhatsAppProvider.sendText(
        data.owner_phone as string,
        formatListingApproval(
          data,
          spend?.ok && spend.spentPoints !== undefined
            ? [
                `تم خصم *${spend.spentPoints} نقطة* من رصيدك.`,
                `رصيدك المتبقي: *${spend.remainingPoints} نقطة*`
              ]
            : []
        )
      );
    } catch (notifyError) {
      console.error("Failed to notify owner about approval", notifyError);
    }
  }

  if (status === "rejected" && data.owner_phone) {
    try {
      await metaWhatsAppProvider.sendText(
        data.owner_phone as string,
        `❌ تم رفض إعلانك من الإدارة.\n\nرقم الإعلان: ${data.property_code ?? String(data.id).slice(0, 8)}${adminNote ? `\nالسبب: ${adminNote}` : ""}\n\nيمكنك تعديل البيانات وإعادة الإرسال.`
      );
    } catch (notifyError) {
      console.error("Failed to notify owner about rejection", notifyError);
    }
  }

  return {
    ok: true,
    message: "تم تحديث الإعلان.",
    data: {
      property: data,
      spentPoints: spend?.ok ? spend.spentPoints : undefined,
      remainingPoints: spend?.ok ? spend.remainingPoints : undefined
    }
  };
}

/**
 * Credits an approved top-up: adds the points, pays the referral commission, sends on any listing or
 * owner number the user was waiting for, and tells them.
 */
export async function creditApprovedTopup(phone: string, points: number): Promise<AdminActionResult> {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { ok: false, message: "قاعدة البيانات غير مربوطة.", reason: "unavailable" };
  }

  const { data: wallet, error: walletFetchError } = await supabase
    .from("user_wallets")
    .select("usage_points,referred_by_phone")
    .eq("phone", phone)
    .maybeSingle();

  if (walletFetchError) {
    return { ok: false, message: walletFetchError.message };
  }

  if (!wallet) {
    return { ok: false, message: "لا توجد محفظة لهذا الرقم.", reason: "not_found" };
  }

  const currentPoints = Number(wallet.usage_points ?? 0);

  const { error: walletUpdateError } = await supabase
    .from("user_wallets")
    .update({ usage_points: currentPoints + points })
    .eq("phone", phone);

  if (walletUpdateError) {
    return { ok: false, message: walletUpdateError.message };
  }

  const { error: ledgerError } = await supabase.from("credit_transactions").insert({
    phone,
    kind: "topup_approved",
    usage_points_delta: points,
    admin_note: "شحن رصيد مُعتمد من الإدارة"
  });

  if (ledgerError) {
    console.error("Failed to record the approved topup", ledgerError);
  }

  await payReferralCommission(phone, wallet.referred_by_phone as string | null, points);

  // A draft still awaiting confirmation predates the move of the listing fee to approval time.
  const conversationState = await getConversationState(phone);
  const draft = conversationState.draftProperty;

  if (draft?.awaitingConfirmation) {
    const submission = await submitPropertyForReview(phone, draft);

    await setConversationState(phone, { ...conversationState, draftProperty: undefined });

    if (submission.saved) {
      try {
        await metaWhatsAppProvider.sendText(
          phone,
          "✅ تم إرسال إعلانك إلى الإدارة للمراجعة. سنخبرك عند الموافقة أو إذا احتاج الإعلان لتعديل."
        );
      } catch (notifyError) {
        console.error("Failed to notify owner about auto-submitted listing", notifyError);
      }
    }
  }

  const contactReply = await fulfillPendingContactRequest(phone);

  if (contactReply) {
    try {
      await metaWhatsAppProvider.sendText(phone, contactReply);
    } catch (notifyError) {
      console.error("Failed to send owner contact after approved topup", notifyError);
    }
  }

  return {
    ok: true,
    message: "تم اعتماد الشحن.",
    data: { points, newBalance: currentPoints + points }
  };
}

async function payReferralCommission(phone: string, referrerPhone: string | null, points: number) {
  if (!referrerPhone) {
    return;
  }

  const supabase = getServiceSupabase();

  if (!supabase) {
    return;
  }

  const { referralCommissionPercent } = await getSettings();
  const commission = Math.floor((points * referralCommissionPercent) / 100);

  if (commission <= 0) {
    return;
  }

  const { data: referrerWallet } = await supabase
    .from("user_wallets")
    .select("commission_points")
    .eq("phone", referrerPhone)
    .maybeSingle();

  if (!referrerWallet) {
    return;
  }

  const { error: commissionError } = await supabase
    .from("user_wallets")
    .update({
      commission_points: Number(referrerWallet.commission_points ?? 0) + commission
    })
    .eq("phone", referrerPhone);

  if (commissionError) {
    console.error("Failed to pay the referral commission", commissionError);
    return;
  }

  await supabase.from("credit_transactions").insert({
    phone: referrerPhone,
    kind: "referral_commission",
    commission_points_delta: commission,
    related_phone: phone,
    admin_note: `${referralCommissionPercent}% عمولة من شحن ${points} نقطة`
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
