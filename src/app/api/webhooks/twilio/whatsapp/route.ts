import { NextResponse } from "next/server";
import { handleIncomingMessage } from "@/lib/conversation/engine";
import { getServiceSupabase } from "@/lib/supabase/server";
import { getWhatsAppProvider } from "@/lib/whatsapp/provider";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const provider = getWhatsAppProvider();
  const formData = await request.formData();
  const incoming = provider.parseIncoming(formData);
  const result = await handleIncomingMessage(incoming);
  const supabase = getServiceSupabase();

  if (supabase) {
    await supabase.from("users").upsert(
      {
        phone: incoming.from,
        role: "renter"
      },
      {
        onConflict: "phone",
        ignoreDuplicates: true
      }
    );

    await supabase.from("conversations").insert({
      phone: incoming.from,
      direction: "inbound",
      message_type: incoming.media.length > 0 ? "media" : incoming.location ? "location" : "text",
      body: incoming.body,
      whatsapp_message_id: incoming.messageId,
      provider: incoming.provider,
      metadata: {
        media: incoming.media,
        location: incoming.location,
        intent: result.debugIntent
      }
    });

    await supabase.from("conversations").insert({
      phone: incoming.from,
      direction: "outbound",
      message_type: "text",
      body: result.reply,
      provider: incoming.provider,
      metadata: {
        intent: result.debugIntent
      }
    });
  }

  await provider.sendText(incoming.from, result.reply);

  return NextResponse.json({
    ok: true,
    reply: result.reply,
    intent: result.debugIntent
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "Twilio WhatsApp webhook"
  });
}
