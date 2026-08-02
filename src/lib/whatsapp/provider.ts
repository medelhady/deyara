import { twilioWhatsAppProvider } from "./twilio";

export function getWhatsAppProvider() {
  const provider = process.env.WHATSAPP_PROVIDER ?? "twilio";

  switch (provider) {
    case "twilio":
      return twilioWhatsAppProvider;
    default:
      return twilioWhatsAppProvider;
  }
}
