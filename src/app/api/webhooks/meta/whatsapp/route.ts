import { NextResponse } from "next/server";
import { handleIncomingMessage } from "@/lib/conversation/engine";
import { getServiceSupabase } from "@/lib/supabase/server";
import { parseMetaStatuses, parseMetaWebhook, verifyMetaSignature } from "@/lib/whatsapp/meta";
import { recordDeliveryFailure, sendNotification, sendVideoNotification } from "@/lib/notifications";
import { notifyAdmins } from "@/lib/notify-admins";
import type { IncomingWhatsAppMessage } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";
// A reply can involve GPT, a media check and two sends. The platform default cuts that off mid-way,
// which loses the message with no error anywhere.
export const maxDuration = 30;

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

  /**
   * An empty reply is the bot staying out of a conversation a person has taken over. The message
   * they wrote is stored either way -- it is what the admin has to read -- but a blank outbound row
   * would show in the thread as the bot having answered with nothing.
   */
  if (reply.trim()) {
    await saveOutbound(incoming, reply, intent);
  }
}

/** Logs one message the bot sent, without re-logging the incoming one that prompted it. */
async function saveOutbound(incoming: IncomingWhatsAppMessage, body: string, intent: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return;
  }

  await supabase.from("conversations").insert({
    phone: incoming.from,
    direction: "outbound",
    message_type: "text",
    body,
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

  /**
   * What became of messages we already sent.
   *
   * Meta answers a send with a 200 and an id, then decides separately whether it can deliver. A
   * message refused after that point is reported only here -- which is why a video that Meta
   * accepted, uploaded and acknowledged could still never arrive, with nothing written down
   * anywhere. Only failures are recorded; sent/delivered/read would bury the log.
   */
  for (const status of parseMetaStatuses(payload)) {
    if (status.status !== "failed") {
      continue;
    }

    console.error(`Delivery failed to ${status.recipient}: ${status.error ?? "no reason given"}`);
    await recordDeliveryFailure(status.recipient, status.error ?? "رفضت ميتا تسليم الرسالة بلا سبب معلن.");

    /**
     * Said out loud, on a phone.
     *
     * This callback is the only existence this failure has: the send returned 200, the log says
     * sent, and a video that reached nobody looks exactly like one that arrived. Written to the log
     * alone it waits for someone to think of opening the log -- which is not what anyone does when a
     * video simply does not turn up.
     */
    await notifyAdmins([
      "⚠️ *رسالة لم تُسلَّم*",
      "",
      `إلى: ${status.recipient.replace("whatsapp:", "")}`,
      status.error ?? "بلا سبب معلن.",
      "",
      "قبِلتها ميتا ثم رفضت تسليمها — غالبًا فيديو. التفاصيل في سجل الإشعارات."
    ]);
  }

  const messages = await parseMetaWebhook(payload);
  const replies = [];

  for (const incoming of messages) {
    const result = await handleIncomingMessage(incoming);
    await saveConversation(incoming, result.reply, result.debugIntent);

    // The video leads and the text follows as its own bubble, rather than riding along as a caption:
    // captions wrap in a narrower box and broke the instruction across lines.
    if (result.video) {
      const sent = await sendVideoNotification(incoming.from, result.video.url, "bot_reply", result.video.label);

      /**
       * A link instead of a video is a degraded send, not a failed one, so nothing else reports it.
       *
       * WhatsApp then drops that link for its own reasons and the person is left with nothing --
       * which is exactly what "the video did not arrive" looks like from the outside, with every log
       * saying the message was sent.
       */
      if (!sent.ok || sent.viaLink) {
        await notifyAdmins([
          "⚠️ *الفيديو لم يُرسَل كفيديو*",
          "",
          `إلى: ${incoming.from.replace("whatsapp:", "")}`,
          sent.ok ? "أُرسِل كرابط نصي بدلًا عنه." : "لم يُرسَل إطلاقًا.",
          "",
          "السبب مكتوب في سجل الإشعارات."
        ]);
      }
    }

    if (result.reply.trim()) {
      await sendNotification(incoming.from, result.reply, "bot_reply");
    }

    // Sent after the reply and in order, so text meant to be forwarded arrives as its own message.
    for (const followUp of result.followUps ?? []) {
      await saveOutbound(incoming, followUp, result.debugIntent);
      await sendNotification(incoming.from, followUp, "bot_reply");
    }

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
