import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase/server";
import { getConversationState, setConversationState } from "@/lib/conversation/store";
import { fulfillPendingContactRequest, spendPointsForListing, submitPropertyForReview } from "@/lib/conversation/engine";
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
      .select("usage_points")
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

    await supabase.from("credit_transactions").insert({
      phone: topup.phone,
      kind: "topup_approved",
      usage_points_delta: topupPoints,
      admin_note: "شحن رصيد مُعتمد من الإدارة"
    });

    const conversationState = await getConversationState(topup.phone);
    const draft = conversationState.draftProperty;

    if (draft?.awaitingConfirmation) {
      const spend = await spendPointsForListing(topup.phone);

      if (spend.ok) {
        const submission = await submitPropertyForReview(topup.phone, draft);

        await setConversationState(topup.phone, {
          ...conversationState,
          draftProperty: undefined
        });

        try {
          await metaWhatsAppProvider.sendText(
            topup.phone,
            submission.saved
              ? `✅ ${spend.reply}\n\nتم إرسال الإعلان إلى الإدارة للمراجعة. سنخبرك عند الموافقة أو إذا احتاج الإعلان لتعديل.`
              : "✅ تم تأكيد الإعلان في المحاكي. عند ربط Supabase سيتم حفظه تلقائيًا وإرساله للإدارة للمراجعة."
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