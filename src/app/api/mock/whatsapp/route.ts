import { NextResponse } from "next/server";
import { z } from "zod";
import { handleIncomingMessage } from "@/lib/conversation/engine";
import type { IncomingWhatsAppMessage } from "@/lib/whatsapp/types";

const mockMessageSchema = z.object({
  from: z.string().min(6).default("whatsapp:+22200000000"),
  body: z.string().default(""),
  media: z
    .array(
      z.object({
        url: z.string().url(),
        contentType: z.string()
      })
    )
    .default([]),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      address: z.string().optional(),
      label: z.string().optional()
    })
    .optional()
});

export async function POST(request: Request) {
  const payload = mockMessageSchema.parse(await request.json());
  const message: IncomingWhatsAppMessage = {
    provider: "twilio",
    messageId: `mock-${Date.now()}`,
    from: payload.from,
    to: "whatsapp:+14155238886",
    body: payload.body,
    media: payload.media,
    location: payload.location
  };

  const result = await handleIncomingMessage(message);

  return NextResponse.json({
    ok: true,
    incoming: message,
    reply: result.reply,
    intent: result.debugIntent
  });
}
