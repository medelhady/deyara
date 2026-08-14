import type { IncomingWhatsAppMessage, WhatsAppProvider } from "./types";

type MetaWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: {
          phone_number_id?: string;
          display_phone_number?: string;
        };
        messages?: Array<{
          id?: string;
          from?: string;
          text?: {
            body?: string;
          };
          image?: {
            id?: string;
            mime_type?: string;
            caption?: string;
          };
          video?: {
            id?: string;
            mime_type?: string;
            caption?: string;
          };
          document?: {
            id?: string;
            mime_type?: string;
            caption?: string;
            filename?: string;
          };
          location?: {
            latitude?: number;
            longitude?: number;
            address?: string;
            name?: string;
          };
        }>;
      };
    }>;
  }>;
};

function normalizeWhatsAppPhone(phone: string) {
  return `whatsapp:+${phone.replace(/\D/g, "")}`;
}

function toMetaRecipient(phone: string) {
  return phone.replace("whatsapp:", "").replace(/\D/g, "");
}

async function getMetaMediaUrl(mediaId?: string) {
  const token = process.env.META_WHATSAPP_TOKEN;

  if (!mediaId || !token) {
    return undefined;
  }

  const response = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    console.error("Failed to read Meta media URL", await response.text());
    return undefined;
  }

  const payload = (await response.json()) as { url?: string };
  return payload.url;
}

export async function parseMetaWebhook(payload: MetaWebhookPayload): Promise<IncomingWhatsAppMessage[]> {
  const parsed: IncomingWhatsAppMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;

      for (const item of value?.messages ?? []) {
        if (!item.from) {
          continue;
        }

        const mediaSource = item.image ?? item.video ?? item.document;
        const mediaUrl = await getMetaMediaUrl(mediaSource?.id);
        const media = mediaUrl
          ? [
              {
                url: mediaUrl,
                contentType: mediaSource?.mime_type ?? "application/octet-stream"
              }
            ]
          : [];

        parsed.push({
          provider: "meta",
          messageId: item.id,
          from: normalizeWhatsAppPhone(item.from),
          to: value?.metadata?.phone_number_id,
          body: item.text?.body?.trim() ?? mediaSource?.caption?.trim() ?? "",
          media,
          location:
            item.location?.latitude && item.location?.longitude
              ? {
                  latitude: item.location.latitude,
                  longitude: item.location.longitude,
                  address: item.location.address,
                  label: item.location.name
                }
              : undefined
        });
      }
    }
  }

  return parsed;
}

export const metaWhatsAppProvider: WhatsAppProvider = {
  parseIncoming() {
    throw new Error("Meta webhooks are JSON-based. Use parseMetaWebhook instead.");
  },

  async sendText(to, body) {
    const token = process.env.META_WHATSAPP_TOKEN;
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
      console.log("Meta WhatsApp credentials missing. Mock reply:", { to, body });
      return;
    }

    const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toMetaRecipient(to),
        type: "text",
        text: {
          preview_url: false,
          body
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Meta WhatsApp send failed: ${await response.text()}`);
    }
  }
};
