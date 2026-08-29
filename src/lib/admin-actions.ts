import { getServiceSupabase } from "@/lib/supabase/server";
import { sendNotification } from "@/lib/notifications";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp/meta";
import { commissionForTopup } from "@/lib/referral";
import { getMessage } from "@/lib/bot-messages";
import {
  ensureWallet,
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
      await sendNotification(current.owner_phone as string, spend.reply, "topup_request");

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
    const charged = spend?.ok && spend.spentPoints !== undefined;

    /**
     * The approved listing_approved template reads "تم نشر إعلانك رقم {{1}} بنجاح. خُصمت {{2}}
     * أوقية، ورصيدك المتبقي {{3}} أوقية." -- it states a deduction, so it only fits a publication
     * that charged one. Re-publishing a hidden listing charges nothing, and Meta refuses a template
     * with an empty parameter anyway, so that case goes without a fallback and simply relies on the
     * 24-hour window as before.
     */
    const templateFallback = charged
      ? {
          name: "listing_approved",
          language: "ar",
          parameters: [
            String(data.property_code ?? String(data.id).slice(0, 8)),
            String(spend!.spentPoints),
            String(spend!.remainingPoints)
          ]
        }
      : undefined;

    await sendNotification(
      data.owner_phone as string,
      formatListingApproval(
        data,
        charged
          ? [
              `تم خصم *${spend!.spentPoints} أوقية* من رصيدك.`,
              `رصيدك المتبقي: *${spend!.remainingPoints} أوقية*`
            ]
          : []
      ),
      "listing_approved",
      templateFallback
    );
  }

  if (status === "rejected" && data.owner_phone) {
    await sendNotification(
      data.owner_phone as string,
      await getMessage("listing_rejected", {
        code: data.property_code ?? String(data.id).slice(0, 8),
        reason: adminNote
      }),
      "listing_rejected",
      {
        name: "listing_rejected",
        language: "ar",
        parameters: [
          String(data.property_code ?? String(data.id).slice(0, 8)),
          // Meta rejects an empty parameter, and a rejection reason is optional here, so the
          // template gets a stand-in rather than no message reaching the owner at all.
          adminNote?.trim() || "لم يُذكر سبب"
        ]
      }
    );
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
    .select("usage_points,referred_by_phone,referred_at")
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

  await payReferralCommission(
    phone,
    wallet.referred_by_phone as string | null,
    points,
    wallet.referred_at as string | null
  );

  const newBalance = currentPoints + points;

  /**
   * Sent unconditionally. This used to depend on the user having a parked listing draft or a
   * contact request waiting, so someone who simply topped up in advance transferred money, had it
   * approved, and heard nothing at all -- while the admin's own confirmation claimed otherwise.
   */
  await sendNotification(
    phone,
    await getMessage("topup_approved", { points, balance: newBalance }),
    "topup_approved",
    // The template is Meta's copy of this text and cannot be edited from here, so the two are worded
    // separately on purpose: editing the message above changes what is sent inside the window only.
    { name: "topup_approved", language: "ar", parameters: [String(points), String(newBalance)] }
  );

  // A draft still awaiting confirmation predates the move of the listing fee to approval time.
  const conversationState = await getConversationState(phone);
  const draft = conversationState.draftProperty;

  if (draft?.awaitingConfirmation) {
    const submission = await submitPropertyForReview(phone, draft);

    await setConversationState(phone, { ...conversationState, draftProperty: undefined });

    if (submission.saved) {
      await sendNotification(
        phone,
        "✅ تم إرسال إعلانك إلى الإدارة للمراجعة. سنخبرك عند الموافقة أو إذا احتاج الإعلان لتعديل.",
        "listing_submitted"
      );
    }
  }

  const contactReply = await fulfillPendingContactRequest(phone);

  if (contactReply) {
    await sendNotification(phone, contactReply, "contact_released");
  }

  return {
    ok: true,
    message: "تم اعتماد الشحن.",
    data: { points, newBalance }
  };
}

/**
 * Registers a number if it is new and puts points in its wallet, on an admin's say-so rather than a
 * payment receipt.
 *
 * Deliberately not routed through creditApprovedTopup: that path pays the referrer their commission,
 * which is right for money that came in and wrong for points an admin granted. It does still release
 * a contact request the renter was waiting on, because from their side the balance is what mattered.
 */
export async function creditWalletManually(
  phoneInput: string,
  points: number,
  note: string,
  adminPhone: string | null
): Promise<AdminActionResult> {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { ok: false, message: "قاعدة البيانات غير مربوطة.", reason: "unavailable" };
  }

  const digits = phoneInput.replace(/\D/g, "");

  if (digits.length < 8) {
    return { ok: false, message: "اكتب رقم الهاتف بصيغة دولية كاملة مع رمز الدولة." };
  }

  if (!Number.isInteger(points) || points <= 0) {
    return { ok: false, message: "المبلغ بالأوقية يجب أن يكون رقمًا صحيحًا أكبر من صفر." };
  }

  // Reuse the row this number already has, whatever shape it was stored in, so crediting an existing
  // user cannot quietly create a second account holding the balance.
  const { data: existing } = await supabase
    .from("users")
    .select("phone")
    .like("phone", `%${digits}`)
    .limit(1);

  const phone = (existing ?? [])[0]?.phone ?? normalizeWhatsAppPhone(digits);

  const wallet = await ensureWallet(phone);

  if (!wallet) {
    return { ok: false, message: "تعذر إنشاء محفظة لهذا الرقم.", reason: "unavailable" };
  }

  const currentPoints = Number(wallet.usage_points ?? 0);
  const newBalance = currentPoints + points;

  const { error: updateError } = await supabase
    .from("user_wallets")
    .update({ usage_points: newBalance })
    .eq("phone", phone);

  if (updateError) {
    return { ok: false, message: updateError.message };
  }

  // The admin goes in admin_note, not related_phone: that column is a foreign key into users, and a
  // dashboard account is not a bot user, so the row would be rejected and the audit trail lost.
  const byLine = adminPhone ? `بواسطة ${adminPhone}` : "بواسطة الإدارة";

  const { error: ledgerError } = await supabase.from("credit_transactions").insert({
    phone,
    kind: "admin_adjustment",
    usage_points_delta: points,
    admin_note: note.trim() ? `${note.trim()} — ${byLine}` : `إضافة رصيد ${byLine}`
  });

  if (ledgerError) {
    console.error("Failed to record the manual credit", ledgerError);
  }

  const contactReply = await fulfillPendingContactRequest(phone);

  await sendNotification(
    phone,
    [
      "💳 *تم إضافة رصيد لحسابك*",
      "",
      `أضافت الإدارة *${points} أوقية* إلى رصيدك.`,
      `رصيدك الآن: *${newBalance} أوقية*`,
      ...(note.trim() ? ["", note.trim()] : [])
    ].join("\n"),
    "balance_credited",
    // The reason stays out of the template: it is optional here and Meta refuses an empty parameter.
    { name: "balance_credited", language: "ar", parameters: [String(points), String(newBalance)] }
  );

  if (contactReply) {
    await sendNotification(phone, contactReply, "contact_released");
  }

  return {
    ok: true,
    // A missing ledger row is said out loud: the balance moved either way, and an admin who thinks
    // the change was recorded when it was not has no way to reconcile it later.
    message: ledgerError
      ? `تمت إضافة ${points} أوقية والرصيد الآن ${newBalance}، لكن تعذّر تسجيلها في سجل الحركات.`
      : `تمت إضافة ${points} أوقية. الرصيد الآن ${newBalance}.`,
    data: { phone, points, newBalance, releasedContact: Boolean(contactReply), ledgerRecorded: !ledgerError }
  };
}

export type WithdrawalStatus = "approved" | "rejected" | "paid";

/**
 * The single place a withdrawal changes status, shared by the dashboard and the WhatsApp commands.
 *
 * Marking one paid is the point of no return: it moves points out of the commission balance into
 * withdrawn, so it is guarded against running twice and against a balance that no longer covers it.
 */
export async function setWithdrawalStatus(
  id: string,
  status: WithdrawalStatus,
  adminNote?: string
): Promise<AdminActionResult> {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { ok: false, message: "قاعدة البيانات غير مربوطة.", reason: "unavailable" };
  }

  const { data: withdrawal, error: withdrawalError } = await supabase
    .from("withdrawal_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (withdrawalError || !withdrawal) {
    return { ok: false, message: withdrawalError?.message ?? "لم أجد طلب السحب.", reason: "not_found" };
  }

  const points = Number(withdrawal.points ?? 0);
  const phone = String(withdrawal.phone);
  const note = adminNote?.trim() || null;

  // Only the first transition into paid moves any points, so re-sending the command cannot pay twice.
  if (status === "paid" && withdrawal.status !== "paid") {
    const { data: wallet, error: walletError } = await supabase
      .from("user_wallets")
      .select("commission_points,withdrawn_commission_points")
      .eq("phone", phone)
      .maybeSingle();

    if (walletError || !wallet) {
      return { ok: false, message: walletError?.message ?? "لم أجد محفظة هذا الرقم.", reason: "not_found" };
    }

    const currentCommission = Number(wallet.commission_points ?? 0);

    if (currentCommission < points) {
      return {
        ok: false,
        message: `رصيد العمولة (${currentCommission}) لا يغطي ${points} أوقية.`,
        reason: "insufficient_points"
      };
    }

    const { error: walletUpdateError } = await supabase
      .from("user_wallets")
      .update({
        commission_points: currentCommission - points,
        withdrawn_commission_points: Number(wallet.withdrawn_commission_points ?? 0) + points
      })
      .eq("phone", phone);

    if (walletUpdateError) {
      return { ok: false, message: walletUpdateError.message };
    }

    const { error: ledgerError } = await supabase.from("credit_transactions").insert({
      phone,
      kind: "withdrawal",
      commission_points_delta: -points,
      admin_note: note
    });

    if (ledgerError) {
      console.error("Failed to record the withdrawal", ledgerError);
    }
  }

  const { data, error } = await supabase
    .from("withdrawal_requests")
    .update({ status, admin_note: note, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return { ok: false, message: error.message };
  }

  // Asking for your money and hearing nothing back is the whole reason this notification exists.
  const messages: Record<WithdrawalStatus, string[]> = {
    approved: [
      "✅ *تمت الموافقة على طلب السحب*",
      "",
      `المبلغ: *${points} أوقية عمولة*`,
      "سنحوّل لك قريبًا ونبلغك عند التحويل."
    ],
    rejected: ["❌ *لم نعتمد طلب السحب*", "", `المبلغ المطلوب: *${points} أوقية*`],
    paid: [
      "💸 *تم تحويل مستحقاتك*",
      "",
      `حوّلنا لك مقابل *${points} أوقية عمولة*.`,
      "خُصمت من رصيد العمولة. اكتب *رصيدي* لمتابعة حسابك."
    ]
  };

  const withdrawalKinds = {
    approved: "withdrawal_approved",
    rejected: "withdrawal_rejected",
    paid: "withdrawal_paid"
  } as const;

  await sendNotification(
    phone,
    [...messages[status], ...(note ? ["", `📝 ${note}`] : [])].join("\n"),
    withdrawalKinds[status],
    // Only the payout has an approved template. Approval and rejection are less costly to miss:
    // the money has not moved yet in either case.
    status === "paid"
      ? { name: "withdrawal_paid", language: "ar", parameters: [String(points)] }
      : undefined
  );

  return { ok: true, message: "تم تحديث طلب السحب.", data: { withdrawal: data, points, phone } };
}

/**
 * Sets a wallet to exact balances, rather than adding to them.
 *
 * The counterpart to creditWalletManually, which can only add: a mistyped credit had no way back,
 * and neither did a balance that drifted. Absolute values are what an admin actually knows here --
 * "make it 500" -- while the ledger still records the difference, so the history stays a record of
 * changes rather than of instructions.
 */
export async function setWalletBalance(
  phoneInput: string,
  usagePoints: number,
  commissionPoints: number,
  note: string,
  adminPhone: string | null
): Promise<AdminActionResult> {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { ok: false, message: "قاعدة البيانات غير مربوطة.", reason: "unavailable" };
  }

  if (![usagePoints, commissionPoints].every((value) => Number.isInteger(value) && value >= 0)) {
    return { ok: false, message: "الرصيد يجب أن يكون رقمًا صحيحًا لا يقل عن صفر." };
  }

  const digits = phoneInput.replace(/\D/g, "");

  const { data: existing } = await supabase.from("users").select("phone").like("phone", `%${digits}`).limit(1);
  const phone = (existing ?? [])[0]?.phone ?? normalizeWhatsAppPhone(digits);

  const wallet = await ensureWallet(phone);

  if (!wallet) {
    return { ok: false, message: "تعذر قراءة محفظة هذا الرقم.", reason: "not_found" };
  }

  const beforeUsage = Number(wallet.usage_points ?? 0);
  const beforeCommission = Number(wallet.commission_points ?? 0);

  if (beforeUsage === usagePoints && beforeCommission === commissionPoints) {
    return { ok: true, message: "لم يتغير شيء، الرصيد كما هو." };
  }

  const { error: updateError } = await supabase
    .from("user_wallets")
    .update({ usage_points: usagePoints, commission_points: commissionPoints })
    .eq("phone", phone);

  if (updateError) {
    return { ok: false, message: updateError.message };
  }

  const byLine = adminPhone ? `بواسطة ${adminPhone}` : "بواسطة الإدارة";

  const { error: ledgerError } = await supabase.from("credit_transactions").insert({
    phone,
    kind: "admin_adjustment",
    usage_points_delta: usagePoints - beforeUsage,
    commission_points_delta: commissionPoints - beforeCommission,
    admin_note: note.trim() ? `${note.trim()} — تعديل رصيد ${byLine}` : `تعديل رصيد ${byLine}`
  });

  if (ledgerError) {
    console.error("Failed to record the balance correction", ledgerError);
  }

  await sendNotification(
    phone,
    [
      "🧾 *تم تعديل رصيدك*",
      "",
      `رصيد الاستخدام: *${usagePoints} أوقية*`,
      `رصيد التسويق: *${commissionPoints} أوقية*`,
      ...(note.trim() ? ["", note.trim()] : [])
    ].join("\n"),
    "balance_credited"
  );

  return {
    ok: true,
    message: ledgerError
      ? `تم التعديل، لكن تعذّر تسجيله في سجل الحركات.`
      : `تم ضبط الرصيد على ${usagePoints} أوقية استخدام و${commissionPoints} أوقية تسويق.`,
    data: { phone, usagePoints, commissionPoints, ledgerRecorded: !ledgerError }
  };
}

async function payReferralCommission(
  phone: string,
  referrerPhone: string | null,
  points: number,
  referredAt: string | null
) {
  if (!referrerPhone) {
    return;
  }

  const supabase = getServiceSupabase();

  if (!supabase) {
    return;
  }

  const { referralCommissionPercent, referralWindowMonths, referralMinTopupPoints } = await getSettings();

  const commission = commissionForTopup({
    points,
    commissionPercent: referralCommissionPercent,
    windowMonths: referralWindowMonths,
    minTopupPoints: referralMinTopupPoints,
    referredAt
  });

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
    admin_note: `${referralCommissionPercent}% عمولة من شحن ${points} أوقية`
  });

  await sendNotification(
    referrerPhone,
    [
      "📣 *عمولة تسويق جديدة*",
      "",
      `أضفنا لك *${commission} أوقية تسويق* من شحن أحد من دعوتهم.`,
      "",
      "📌 لمتابعة رصيدك اكتب: *رصيدي*"
    ].join("\n"),
    "referral_commission",
    { name: "referral_commission", language: "ar", parameters: [String(commission)] }
  );
}
