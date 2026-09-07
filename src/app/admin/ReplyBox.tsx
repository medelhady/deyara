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
  handoverUntil,
  onSent,
  onHandoverEnd,
  formatWhen
}: {
  phone: string;
  window: ReplyWindow | null;
  /** When the bot may speak to this number again, or null when it is answering normally. */
  handoverUntil?: string | null;
  onSent?: () => void | Promise<void>;
  onHandoverEnd?: () => void | Promise<void>;
  formatWhen: (value: string) => string;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [returning, setReturning] = useState(false);
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
      // Said here rather than left to be discovered: from now on the bot answers nothing, and an
      // admin who does not know that is an admin who walks away from an open conversation.
      setNote({ kind: "ok", text: "✅ أُرسلت — البوت صامت مع هذا الرقم 12 ساعة." });
    } finally {
      setSending(false);
    }
  }

  /** Hands the conversation back before the deadline, when the exchange is finished. */
  async function returnToBot() {
    setReturning(true);

    try {
      const response = await fetch("/api/admin/conversations/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, active: false })
      });
      const data = await response.json();

      await onHandoverEnd?.();

      setNote(
        response.ok
          ? { kind: "ok", text: "↩ عادت المحادثة للبوت." }
          : { kind: "error", text: data.error ?? "تعذر إرجاع المحادثة." }
      );
    } finally {
      setReturning(false);
    }
  }

  const handedOver = Boolean(handoverUntil && new Date(handoverUntil).getTime() > Date.now());

  return (
    <div className="reply-box">
      {note ? <p className={note.kind === "ok" ? "reply-ok" : "auth-error"}>{note.text}</p> : null}

      {/* While this is up, nothing the user writes gets a bot answer -- so it says who is
          responsible and how to hand it back, in the one place the answering happens. */}
      {handedOver ? (
        <div className="handover-note">
          <span>
            👤 المحادثة بيدك — البوت صامت حتى {formatWhen(handoverUntil as string)}
          </span>
          <button className="button secondary" type="button" disabled={returning} onClick={() => void returnToBot()}>
            {returning ? "..." : "↩ أعِد المحادثة للبوت"}
          </button>
        </div>
      ) : null}

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
