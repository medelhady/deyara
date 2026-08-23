import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { explainSendError, isOutsideServiceWindow } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ notifications: [], mode: "mock" });
  }

  const onlyFailed = new URL(request.url).searchParams.get("failed") === "1";

  let query = supabase
    .from("notification_log")
    .select("id,phone,kind,body,status,error,created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (onlyFailed) {
    query = query.eq("status", "failed");
  }

  const { data, error } = await query;

  if (error) {
    const missingTable = error.code === "PGRST205" || (error.message ?? "").includes("notification_log");

    return NextResponse.json(
      {
        error: missingTable
          ? "جدول سجل الإشعارات notification_log غير موجود. شغّل ملف supabase/add-notification-log.sql في محرر SQL بـ Supabase ثم أعد المحاولة."
          : error.message
      },
      { status: 400 }
    );
  }

  const notifications = (data ?? []).map((row) => ({
    ...row,
    // Explained here so the page shows what to do, not a raw Meta payload.
    explained: row.error ? explainSendError(String(row.error)) : null,
    outsideWindow: isOutsideServiceWindow(row.error as string | null)
  }));

  const failed = notifications.filter((row) => row.status === "failed");

  return NextResponse.json(
    {
      notifications,
      summary: {
        total: notifications.length,
        failed: failed.length,
        outsideWindow: failed.filter((row) => row.outsideWindow).length
      }
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}
