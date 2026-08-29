import { metaWhatsAppProvider } from "./meta";

/**
 * The provider that sends WhatsApp messages.
 *
 * Meta is the only one now. Twilio was removed once it had gone unused: it was a second unverified
 * webhook and a second set of credentials to keep working, and the provider switch had already
 * caused an outage of its own by silently routing every proactive message to the side that had no
 * credentials.
 *
 * Kept as a function rather than exporting the provider directly, so adding a second one later is
 * a change here rather than at every call site.
 */
export function getWhatsAppProvider() {
  return metaWhatsAppProvider;
}
