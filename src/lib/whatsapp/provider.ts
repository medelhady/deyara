import { metaWhatsAppProvider } from "./meta";
import { twilioWhatsAppProvider } from "./twilio";

/**
 * Picks the provider that sends and receives WhatsApp messages.
 *
 * WHATSAPP_PROVIDER wins when it names a provider. Otherwise the choice follows whichever provider
 * actually has credentials, because the old unconditional "twilio" default was silently destructive:
 * a deployment running on Meta without the variable set would route every proactive message to
 * Twilio, whose sendText logs a mock line and returns when credentials are missing. Nothing threw,
 * nothing was sent, and the flows that trigger those messages carried on as if they had been.
 */
export function getWhatsAppProvider() {
  const configured = process.env.WHATSAPP_PROVIDER?.trim().toLowerCase();

  if (configured === "meta") {
    return metaWhatsAppProvider;
  }

  if (configured === "twilio") {
    return twilioWhatsAppProvider;
  }

  if (process.env.META_WHATSAPP_TOKEN && process.env.META_PHONE_NUMBER_ID) {
    return metaWhatsAppProvider;
  }

  return twilioWhatsAppProvider;
}
