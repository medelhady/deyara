import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { sendNotification } from "@/lib/notifications";
// The wording and the window live in lib: a route file may only export the handlers, and a check
// that had to read this file as text would not be reading the thing that runs.
import { canReply, formatAdminReply } from "@/lib/admin-reply";

export const dynamic = "force-dynamic";

/** One reply, from the admin, into an existing conversation. */
export async function POST(request: Request) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "قاعدة البيانات غير مربوطة." }, { status: 400 });
  }

  const payload = (await request.json()) as { phone?: string; body?: string };
  const phone = String(payload.phone ?? "").trim();
  const body = String(payload.body ?? "").trim();

  if (!phone) {
    return NextResponse.json({ error: "لم تحدد رقمًا." }, { status: 400 });
  }

  if (!body) {
    return NextResponse.json({ error: "اكتب نص الرسالة أولًا." }, { status: 400 });
  }

  /**
   * The window is checked here, not only in the page.
   *
   * WhatsApp refuses free-form text to anyone who has not written in the last 24 hours. Letting the
   * send go anyway would spend the attempt, log a failure, and tell the admin nothing they could
   * have known before typing.
   */
  const { data: lastInbound } = await supabase
    .from("conversations")
    .select("created_at")
    .eq("phone", phone)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const replyWindow = canReply(lastInbound?.created_at ? String(lastInbound.created_at) : null);

  if (!replyWindow.open) {
    return NextResponse.json(
      {
        error: replyWindow.everWrote
          ? "مرت أكثر من 24 ساعة منذ آخر رسالة من هذا الرقم، وواتساب يمنع الرد الحر بعدها. انتظر حتى يراسلك من جديد."
          : "هذا الرقم لم يراسل البوت قط، فلا يمكن بدء محادثة معه من هنا."
      },
      { status: 400 }
    );
  }

  const text = formatAdminReply(body);
  const result = await sendNotification(phone, text, "admin_broadcast");

  if (!result.ok) {
    return NextResponse.json({ error: result.explained }, { status: 400 });
  }

  // Written to the same table the bot writes to, so the reply appears in the thread where it was
  // typed rather than only in the notification log.
  await supabase.from("conversations").insert({
    phone,
    direction: "outbound",
    message_type: "text",
    body: text,
    provider: "meta",
    metadata: { intent: "admin_reply" }
  });

  return NextResponse.json({ ok: true });
}
