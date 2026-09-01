import crypto from "node:crypto";
import { inspectMp4 } from "@/lib/mp4-inspect";
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
        /**
         * What became of a message after Meta accepted it.
         *
         * The only place a delivery failure is ever reported. Meta answers a send with a 200 and an
         * id, then decides separately whether it can actually deliver -- so a message that is
         * refused after acceptance leaves no trace at all unless these are read.
         */
        statuses?: Array<{
          id?: string;
          status?: string;
          recipient_id?: string;
          errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>;
        }>;
      };
    }>;
  }>;
};

export type MetaDeliveryStatus = {
  messageId: string;
  status: string;
  recipient: string;
  error?: string;
};

/** Pulls the delivery outcomes out of a webhook payload. Empty for an ordinary incoming message. */
export function parseMetaStatuses(payload: MetaWebhookPayload): MetaDeliveryStatus[] {
  const statuses: MetaDeliveryStatus[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const item of change.value?.statuses ?? []) {
        const failure = item.errors?.[0];

        statuses.push({
          messageId: String(item.id ?? ""),
          status: String(item.status ?? ""),
          recipient: item.recipient_id ? normalizeWhatsAppPhone(String(item.recipient_id)) : "",
          error: failure
            ? [failure.code ? `(#${failure.code})` : "", failure.title, failure.message, failure.error_data?.details]
                .filter(Boolean)
                .join(" — ")
            : undefined
        });
      }
    }
  }

  return statuses;
}

/** The shape every phone number is stored in. Exported so nothing builds a second, subtly different one. */
export function normalizeWhatsAppPhone(phone: string) {
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

/**
 * Meta signs every webhook delivery with the app secret. The check matters more here than it looks:
 * `from` on the parsed message is what authorises the admin WhatsApp commands, so an unverified
 * endpoint lets anyone who guesses the URL post a payload claiming to be an admin number and approve
 * listings or credit points.
 *
 * Returns true when META_APP_SECRET is unset, so an existing deployment keeps working until the
 * secret is added. The warning is the signal that the endpoint is still open.
 */
export function verifyMetaSignature(rawBody: string, signatureHeader: string | null) {
  const secret = process.env.META_APP_SECRET;

  if (!secret) {
    console.warn(
      "META_APP_SECRET is not set. The Meta webhook is accepting unverified requests, which means anyone who knows the URL can send messages as any number, including an admin one."
    );
    return true;
  }

  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const received = Buffer.from(signatureHeader.slice("sha256=".length), "hex");

  // timingSafeEqual throws on a length mismatch, and a malformed hex header decodes short.
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
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

/**
 * Sends an approved message template.
 *
 * The only way to reach someone who has not written in the last 24 hours: WhatsApp refuses
 * free-form text outside that window, and a template is text Meta has already reviewed.
 *
 * Every placeholder must be given a value. Meta rejects the send outright if a parameter is
 * missing or empty, so a template whose wording assumes an optional value cannot be used for the
 * cases where that value is absent.
 */
export async function sendMetaTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  parameters: string[]
) {
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Meta WhatsApp credentials are missing: META_WHATSAPP_TOKEN or META_PHONE_NUMBER_ID.");
    }

    console.log("Meta WhatsApp credentials missing. Mock template:", { to, templateName, parameters });
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
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: parameters.length
          ? [
              {
                type: "body",
                parameters: parameters.map((text) => ({ type: "text", text }))
              }
            ]
          : []
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Meta template send failed: ${await response.text()}`);
  }
}

/**
 * Posts one message to the Graph API.
 *
 * Shared by every kind of send so the credential check and the error text stay in one place: a
 * missing token used to fail differently depending on which call site hit it first.
 */
async function postMessage(to: string, payload: Record<string, unknown>, describe: string) {
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    // Silence here reads as success to every caller, so only pretend to send outside production.
    if (process.env.NODE_ENV === "production") {
      throw new Error("Meta WhatsApp credentials are missing: META_WHATSAPP_TOKEN or META_PHONE_NUMBER_ID.");
    }

    console.log("Meta WhatsApp credentials missing. Mock reply:", { to, ...payload });
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
      ...payload
    })
  });

  if (!response.ok) {
    throw new Error(`Meta WhatsApp ${describe} failed: ${await response.text()}`);
  }
}

/**
 * A file WhatsApp will never relay, whatever we do with it.
 *
 * Separate from an upload that merely failed: retrying by link is worth it when the upload broke,
 * and pointless when the file itself is the problem -- Meta would accept the link too, and drop it
 * just as quietly.
 */
export class UnusableMediaError extends Error {}

/**
 * Puts a video into Meta's own media store and returns its id.
 *
 * Returns null when there is nothing to upload with, so the caller can fall back rather than fail:
 * during development there are no credentials, and if fetching the file from storage is what broke,
 * Meta fetching it itself is still worth a try.
 *
 * Throws when Meta rejects the upload, because that is the answer worth having -- an id that never
 * comes back is exactly the silence this exists to end.
 */
export async function uploadMetaVideo(link: string) {
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    return null;
  }

  const file = await fetch(link);

  if (!file.ok) {
    console.error("Could not read the video from storage", file.status);
    return null;
  }

  const contentType = file.headers.get("content-type") ?? "video/mp4";
  const bytes = new Uint8Array(await file.arrayBuffer());

  /**
   * Checked here because these bytes are already in hand, and because Meta will not tell us in time.
   * It accepts the upload, returns a media id, accepts the send -- and only then decides it cannot
   * process the file, reporting that in a delivery callback seconds later. A renter meanwhile sees
   * nothing at all. This is the last moment the difference can still be acted on.
   */
  const report = inspectMp4(bytes);

  if (report.problems.length > 0) {
    throw new UnusableMediaError(report.problems.join(" "));
  }

  const form = new FormData();

  form.append("messaging_product", "whatsapp");
  form.append("type", contentType);
  // The bytes already read above: a response body can only be consumed once.
  form.append("file", new Blob([bytes], { type: contentType }), "video.mp4");

  // No Content-Type header: fetch sets the multipart boundary itself, and overriding it corrupts the
  // body in a way Meta reports only as a generic upload error.
  const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Meta media upload failed: ${text}`);
  }

  const id = (JSON.parse(text) as { id?: string }).id;

  if (!id) {
    throw new Error(`Meta media upload returned no id: ${text}`);
  }

  return id;
}

export const metaWhatsAppProvider: WhatsAppProvider = {
  // Incoming messages are parsed by parseMetaWebhook, which reads JSON. The form-data parseIncoming
  // that used to sit here existed only to satisfy an interface shared with Twilio, and threw.
  async sendText(to, body) {
    await postMessage(to, { type: "text", text: { preview_url: false, body } }, "send");
  },

  /**
   * Sends a video by uploading it to Meta first, falling back to handing over the link.
   *
   * Handing Meta a link looks simpler and hid a whole class of failure: Meta answers the send before
   * it fetches the URL, so anything that goes wrong on its side -- an expired signature, a host it
   * cannot reach, a file it will not take -- is accepted with a 200 and then dropped. Nothing is
   * logged, and the listing looks identical to one that sent fine.
   *
   * Uploading first moves every one of those failures in front of us, where they arrive as an error
   * with a reason attached. The link path is kept for the case where our own fetch of the file is
   * what fails, since that is the one situation where Meta might still manage it.
   */
  async sendVideo(to, link, caption) {
    let id: string | null = null;

    // Only the upload is caught. A send that fails has already been accepted as far as the media is
    // concerned, so retrying it by link would post the video twice on any error that is not about
    // the file at all -- a closed 24-hour window, an unreachable number.
    try {
      id = await uploadMetaVideo(link);
    } catch (error) {
      // A file Meta cannot process is refused by link too, and by link it is refused silently. The
      // caller has a text fallback that at least reaches the renter, so let this reach it.
      if (error instanceof UnusableMediaError) {
        throw error;
      }

      console.error("Meta media upload failed, falling back to the link", error);
    }

    const media = id ? { id } : { link };

    await postMessage(to, { type: "video", video: caption ? { ...media, caption } : media }, "video send");
  }
};
