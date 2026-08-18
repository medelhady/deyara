import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase/server";
import { metaWhatsAppProvider } from "@/lib/whatsapp/meta";
import { formatListingApproval, spendPointsForListing } from "@/lib/conversation/engine";

export const dynamic = "force-dynamic";

const statusSchema = z.object({
  status: z.enum(["active", "rejected", "hidden", "rented"]),
  admin_note: z.string().optional()
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const payload = statusSchema.parse(await request.json());

  const { data: current, error: currentError } = await supabase
    .from("properties")
    .select("*")
    .eq("id", params.id)
    .single();

  if (currentError || !current) {
    return NextResponse.json({ error: currentError?.message ?? "Property not found." }, { status: 404 });
  }

  // Publishing is what costs points, and it must not go through on an empty wallet. Charge before
  // flipping the status so a failed payment cannot leave a listing live for free. Only the first
  // publication is charged: hidden and rented listings were already paid for, so bringing one back
  // is free.
  const chargesListingFee =
    payload.status === "active" && (current.status === "pending_review" || current.status === "rejected");
  let spend: Awaited<ReturnType<typeof spendPointsForListing>> | null = null;

  if (chargesListingFee && current.owner_phone) {
    spend = await spendPointsForListing(current.owner_phone);

    if (!spend.ok) {
      try {
        await metaWhatsAppProvider.sendText(current.owner_phone, spend.reply);
      } catch (notifyError) {
        console.error("Failed to ask the owner to top up", notifyError);
      }

      return NextResponse.json(
        {
          error: "رصيد المؤجر لا يكفي لنشر الإعلان. أرسلنا له طلب شحن، أعد المحاولة بعد الشحن.",
          reason: "insufficient_points"
        },
        { status: 409 }
      );
    }
  }

  const { data, error } = await supabase
    .from("properties")
    .update({
      status: payload.status,
      admin_note: payload.admin_note,
      updated_at: new Date().toISOString()
    })
    .eq("id", params.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (payload.status === "active" && data.owner_phone) {
    try {
      await metaWhatsAppProvider.sendText(
        data.owner_phone,
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

  if (payload.status === "rejected" && data.owner_phone) {
    try {
      await metaWhatsAppProvider.sendText(
        data.owner_phone,
        `❌ تم رفض إعلانك من الإدارة.\n\nرقم الإعلان: ${data.property_code ?? data.id.slice(0, 8)}${payload.admin_note ? `\nالسبب: ${payload.admin_note}` : ""}\n\nيمكنك تعديل البيانات وإعادة الإرسال.`
      );
    } catch (notifyError) {
      console.error("Failed to notify owner about rejection", notifyError);
    }
  }

  return NextResponse.json({ property: data });
}
