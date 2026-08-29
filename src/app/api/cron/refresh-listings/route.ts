import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { sendRefreshReminders } from "@/lib/listing-refresh";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Reminds owners to retire listings that are no longer available.
 *
 * Called by the Vercel cron in vercel.json. It sits outside /api/admin on purpose -- the admin
 * middleware expects a session cookie and a scheduler has none -- so it carries its own guard.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    // Same rule as the dashboard: missing configuration refuses in production rather than leaving an
    // endpoint that sends WhatsApp messages open to anyone who finds the URL.
    if (process.env.NODE_ENV === "production") {
      console.error("CRON_SECRET is not set: refusing to run the listing refresh.");
      return NextResponse.json({ error: "CRON_SECRET غير مضبوط." }, { status: 503 });
    }
  } else if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listingRefreshHours } = await getSettings();

  if (listingRefreshHours <= 0) {
    return NextResponse.json({ skipped: true, reason: "التذكير موقوف من الإعدادات." });
  }

  const results = await sendRefreshReminders();

  return NextResponse.json({
    owners: results.length,
    sent: results.filter((result) => result.sent).length,
    failed: results.filter((result) => !result.sent).length,
    results
  });
}
