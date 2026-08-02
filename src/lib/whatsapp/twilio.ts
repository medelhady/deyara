import twilio from "twilio";
import type { IncomingWhatsAppMessage, WhatsAppProvider } from "./types";

function value(formData: FormData, key: string) {
  const found = formData.get(key);
  return typeof found === "string" ? found : "";
}

export const twilioWhatsAppProvider: WhatsAppProvider = {
  parseIncoming(formData) {
    const mediaCount = Number(value(formData, "NumMedia") || "0");
    const media = Array.from({ length: mediaCount }, (_, index) => ({
      url: value(formData, `MediaUrl${index}`),
      contentType: value(formData, `MediaContentType${index}`)
    })).filter((item) => item.url);

    const latitude = value(formData, "Latitude");
    const longitude = value(formData, "Longitude");

    return {
      provider: "twilio",
      messageId: value(formData, "MessageSid") || value(formData, "SmsMessageSid"),
      from: value(formData, "From"),
      to: value(formData, "To"),
      body: value(formData, "Body").trim(),
      media,
      location:
        latitude && longitude
          ? {
              latitude: Number(latitude),
              longitude: Number(longitude),
              address: value(formData, "Address") || undefined,
              label: value(formData, "Label") || undefined
            }
          : undefined
    };
  },

  async sendText(to, body) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_WHATSAPP_FROM;

    if (!accountSid || !authToken || !from) {
      console.log("Twilio credentials missing. Mock reply:", { to, body });
      return;
    }

    const client = twilio(accountSid, authToken);
    await client.messages.create({
      from,
      to,
      body
    });
  }
};
