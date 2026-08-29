import { getSettings } from "@/lib/settings";
import { sendNotification } from "@/lib/notifications";

/**
 * Tells the admins something needs their attention on WhatsApp, so they do not have to keep the
 * dashboard open. Never throws: a failed notification must not break the flow that triggered it.
 * Each attempt is written to the notification log, which is where a silent failure shows up.
 */
/**
 * A one-line version of the alert, for the template parameter.
 *
 * Meta rejects a parameter that is empty or carries a newline, so this takes the headline, strips
 * the markdown and collapses it, and falls back to something rather than sending nothing.
 */
function summarise(lines: string[]) {
  const headline = lines.find((line) => line.trim()) ?? "";
  const clean = headline.replace(/\*/g, "").replace(/\s+/g, " ").trim().slice(0, 120);

  return clean || "طلب جديد";
}

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
     * Admin alerts need the template more than any other message. An admin works from the
     * dashboard, not from WhatsApp, so their own 24-hour window is closed almost all the time --
     * which meant these alerts were failing nearly always, quietly, for the person least likely to
     * be told about it.
     */
    await Promise.all(
      numbers.map((number) =>
        sendNotification(number, body, "admin_alert", {
          name: "admin_alert",
          language: "ar",
          parameters: [summarise(lines)]
        })
      )
    );
  } catch (error) {
    console.error("Failed to send admin notifications", error);
  }
}
