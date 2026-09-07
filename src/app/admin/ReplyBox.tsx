"use client";

import { useState } from "react";

export type ReplyWindow = { open: boolean; openUntil: string | null; lastInboundAt: string | null };

/**
 * One reply into a WhatsApp conversation, from wherever the admin happens to be looking.
 *
 * Shared rather than written twice: the conversations page and the demand page both end in the same
 * act, and two copies of a rule as easily missed as the 24-hour window is one copy that will quietly
 * stop matching the server.
 *
 * When the window has closed there is nothing to type into -- WhatsApp refuses free-form text to
 * anyone who has not written in a day -- so the box is replaced by the reason and the one route
 * still open: the admin's own phone.
 */
export function ReplyBox({
  phone,
  window: replyWindow,
  onSent,
  formatWhen
}: {
  phone: string;
  window: ReplyWindow | null;
  onSent?: () => void | Promise<void>;
  formatWhen: (value: string) => string;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const number = phone.replace("whatsapp:", "").replace(/\D/g, "");

  async function send() {
    if (sending || !draft.trim()) {
      return;
    }

    setSending(true);
    setNote(null);

    try {
      const response = await fetch("/api/admin/conversations/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, body: draft })
      });
      const data = await response.json();

      if (!response.ok) {
        setNote({ kind: "error", text: data.error ?? "تعذر الإرسال." });
        return;
      }

      setDraft("");
      await onSent?.();
      setNote({ kind: "ok", text: "✅ أُرسلت." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="reply-box">
      {note ? <p className={note.kind === "ok" ? "reply-ok" : "auth-error"}>{note.text}</p> : null}

      {replyWindow?.open ? (
        <>
          <textarea
            rows={3}
            placeholder="اكتب ردك على هذا الرقم..."
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="row-actions">
            <button
              className="button"
              type="button"
              disabled={sending || draft.trim().length === 0}
              onClick={() => void send()}
            >
              {sending ? "جارٍ الإرسال..." : "إرسال"}
            </button>
            <span className="amount-note">يصل مسبوقًا بـ«👤 من إدارة الديارة:» ليعرف أنه يكلّم إنسانًا.</span>
          </div>
        </>
      ) : (
        <div className="row-actions">
          <p className="amount-note">
            ⏰ لا يمكن الرد من هنا — واتساب يمنع الرسائل الحرة بعد مرور 24 ساعة على آخر رسالة من هذا
            الرقم
            {replyWindow?.lastInboundAt ? `، وآخر رسالة منه كانت ${formatWhen(replyWindow.lastInboundAt)}` : ""}.
          </p>
          {/* The one route still open, and the reason it is offered only here: from the admin's own
              phone the window does not apply. */}
          <a className="button secondary" href={`https://wa.me/${number}`} target="_blank" rel="noreferrer">
            افتح واتساب من هاتفك
          </a>
        </div>
      )}
    </div>
  );
}
