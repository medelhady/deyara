import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase/server";
import { metaWhatsAppProvider } from "@/lib/whatsapp/meta";

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
        `✅ تمت الموافقة على إعلانك ونشره الآن.\n\nرقم الإعلان: ${data.property_code ?? data.id.slice(0, 8)}\nالمنطقة: ${data.area ?? "غير محددة"}\nالسعر: ${data.price ?? "غير محدد"}`
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
