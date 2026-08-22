import { NextResponse } from "next/server";
import { handleIncomingMessage } from "@/lib/conversation/engine";
import { getServiceSupabase } from "@/lib/supabase/server";
import { metaWhatsAppProvider, parseMetaWebhook, verifyMetaSignature } from "@/lib/whatsapp/meta";
import type { IncomingWhatsAppMessage } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";

async function saveConversation(incoming: IncomingWhatsAppMessage, reply: string, intent: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return;
  }

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
      intent
    }
  });

  await supabase.from("conversations").insert({
    phone: incoming.from,
    direction: "outbound",
    message_type: "text",
    body: reply,
    provider: incoming.provider,
    metadata: {
      intent
    }
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const verifyToken = process.env.META_VERIFY_TOKEN;

  if (mode === "subscribe" && token && token === verifyToken && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: {
        "Content-Type": "text/plain"
      }
    });
  }

  return NextResponse.json({ ok: false, error: "Invalid Meta verify token." }, { status: 403 });
}

export async function POST(request: Request) {
  // Read the body as text: the signature covers the exact bytes Meta sent, so re-serialising the
  // parsed JSON would not match.
  const rawBody = await request.text();

  if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ ok: false, error: "Invalid Meta signature." }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const messages = await parseMetaWebhook(payload);
  const replies = [];

  for (const incoming of messages) {
    const result = await handleIncomingMessage(incoming);
    await saveConversation(incoming, result.reply, result.debugIntent);
    await metaWhatsAppProvider.sendText(incoming.from, result.reply);

    replies.push({
      to: incoming.from,
      intent: result.debugIntent,
      reply: result.reply
    });
  }

  return NextResponse.json({
    ok: true,
    processed: replies.length,
    replies
  });
}
