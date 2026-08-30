import { getSettings } from "@/lib/settings";
import { sendNotification } from "@/lib/notifications";

/**
 * Tells the admins something needs their attention on WhatsApp, so they do not have to keep the
 * dashboard open. Never throws: a failed notification must not break the flow that triggered it.
 * Each attempt is written to the notification log, which is where a silent failure shows up.
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

    /**
     * No template fallback, deliberately. Meta classes an alert like this as Marketing, and these
     * are the most frequent messages the system sends -- one per receipt, one per listing -- so
     * paying marketing rates to tell the admin something the dashboard already shows is the
     * expensive way to be told. Outside the 24-hour window these fail, and /admin is the source of
     * truth: it refreshes on its own and counts what is waiting.
     */
    await Promise.all(numbers.map((number) => sendNotification(number, body, "admin_alert")));
  } catch (error) {
    console.error("Failed to send admin notifications", error);
  }
}
