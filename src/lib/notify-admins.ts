import { getSettings } from "@/lib/settings";
import { getWhatsAppProvider } from "@/lib/whatsapp/provider";

/**
 * Tells the admins something needs their attention on WhatsApp, so they do not have to keep the
 * dashboard open. Never throws: a failed notification must not break the flow that triggered it.
 */
export async function notifyAdmins(lines: string[]) {
  try {
    const { adminNotifyNumbers } = await getSettings();
    const numbers = adminNotifyNumbers
      .split(",")
      .map((number) => number.trim())
      .filter(Boolean);

    if (numbers.length === 0) {
      return;
    }

    const body = lines.join("\n");

    await Promise.all(
      numbers.map(async (number) => {
        try {
          await getWhatsAppProvider().sendText(number, body);
        } catch (error) {
          console.error(`Failed to notify admin ${number}`, error);
        }
      })
    );
  } catch (error) {
    console.error("Failed to send admin notifications", error);
  }
}
