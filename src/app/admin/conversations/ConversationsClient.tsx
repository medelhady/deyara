"use client";

import { useEffect, useMemo, useState } from "react";

type Thread = {
  phone: string;
  lastMessage: string;
  lastDirection: string;
  lastAt: string;
  count: number;
  /** When WhatsApp stops accepting a free-form reply to this number. Null if they never wrote. */
  openUntil: string | null;
};

type ReplyWindow = { open: boolean; openUntil: string | null; lastInboundAt: string | null };

type Message = {
  id: string;
  phone: string;
  direction: string;
  message_type: string;
  body: string | null;
  created_at: string;
};

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ar", { dateStyle: "short", timeStyle: "short" });
}

export function ConversationsClient() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("جار تحميل المحادثات...");
  const [replyWindow, setReplyWindow] = useState<ReplyWindow | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [replyNote, setReplyNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function loadThreads() {
    const response = await fetch(`/api/admin/conversations?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();

    if (data.mode === "mock") {
      setMessage("Supabase غير مربوط بعد. بعد إضافة المفاتيح ستظهر المحادثات هنا.");
      return;
    }

    if (!response.ok) {
      setMessage(data.error ?? "تعذر تحميل المحادثات.");
      return;
    }

    setThreads(data.threads ?? []);
    setMessage((data.threads ?? []).length ? "" : "لا توجد محادثات بعد.");
  }

  async function openThread(phone: string) {
    setSelected(phone);
    setMessages([]);

    const response = await fetch(`/api/admin/conversations?phone=${encodeURIComponent(phone)}&t=${Date.now()}`, {
      cache: "no-store"
    });
    const data = await response.json();

    setMessages(data.messages ?? []);
    setReplyWindow(data.window ?? null);
    setDraft("");
    setReplyNote(null);
  }

  /**
   * Sends one reply into the open conversation.
   *
   * The window is re-checked on the server, so this cannot send what WhatsApp would refuse -- but it
   * is shown here too, because the useful moment to learn it is before typing, not after.
   */
  async function sendReply() {
    if (sending || !selected || !draft.trim()) {
      return;
    }

    setSending(true);
    setReplyNote(null);

    try {
      const response = await fetch("/api/admin/conversations/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selected, body: draft })
      });
      const data = await response.json();

      if (!response.ok) {
        setReplyNote({ kind: "error", text: data.error ?? "تعذر الإرسال." });
        return;
      }

      setDraft("");
      await openThread(selected);
      setReplyNote({ kind: "ok", text: "✅ أُرسلت." });
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    void loadThreads();
  }, []);

  const visibleThreads = useMemo(() => {
    const term = search.replace(/\s/g, "");
    return threads.filter((thread) => !term || thread.phone.replace(/\s/g, "").includes(term));
  }, [threads, search]);

  return (
    <section className="simulator">
      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">المحادثات</p>
            <h2>{threads.length} رقم</h2>
          </div>
          <input
            type="search"
            placeholder="ابحث برقم الهاتف"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {message ? <p>{message}</p> : null}

        <div className="compact-list">
          {visibleThreads.map((thread) => (
            <button
              key={thread.phone}
              type="button"
              className={selected === thread.phone ? "thread-row active" : "thread-row"}
              onClick={() => void openThread(thread.phone)}
            >
              <strong>
                {thread.phone.replace("whatsapp:", "")}
                {/* Shown on the list, not only inside: it is what decides whether opening this
                    thread to answer is worth doing at all. */}
                {thread.openUntil && new Date(thread.openUntil).getTime() > Date.now() ? (
                  <span className="thread-open" title="يمكن الرد على هذا الرقم الآن">
                    {" "}
                    💬
                  </span>
                ) : null}
              </strong>
              <span>
                {thread.lastDirection === "inbound" ? "↩ " : "↪ "}
                {thread.lastMessage.slice(0, 60)}
              </span>
              <small>{formatTime(thread.lastAt)}</small>
            </button>
          ))}
        </div>
      </article>

      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">التفاصيل</p>
            <h2>{selected ? selected.replace("whatsapp:", "") : "اختر رقمًا"}</h2>
          </div>
          {selected ? (
            <button className="button secondary" type="button" onClick={() => void openThread(selected)}>
              تحديث
            </button>
          ) : null}
        </div>

        <div className="phone-preview">
          {!selected ? (
            <p className="empty">اختر رقمًا من القائمة لعرض محادثته الكاملة.</p>
          ) : messages.length === 0 ? (
            <p className="empty">لا توجد رسائل.</p>
          ) : (
            messages.map((item) => (
              <div className={item.direction === "inbound" ? "bubble inbound" : "bubble outbound"} key={item.id}>
                <p>{item.body?.trim() || `(${item.message_type})`}</p>
                <span>{formatTime(item.created_at)}</span>
              </div>
            ))
          )}
        </div>

        {selected ? (
          <div className="reply-box">
            {replyNote ? (
              <p className={replyNote.kind === "ok" ? "reply-ok" : "auth-error"}>{replyNote.text}</p>
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
                    onClick={() => void sendReply()}
                  >
                    {sending ? "جارٍ الإرسال..." : "إرسال"}
                  </button>
                  <span className="amount-note">
                    يصل مسبوقًا بـ«👤 من إدارة الديارة:» ليعرف أنه يكلّم إنسانًا.
                  </span>
                </div>
              </>
            ) : (
              /* Said plainly instead of a disabled box with no explanation: the admin can do nothing
                 about it except wait, and needs to know that is the situation. */
              <p className="amount-note">
                ⏰ لا يمكن الرد الآن — واتساب يمنع الرسائل الحرة بعد مرور 24 ساعة على آخر رسالة من هذا
                الرقم
                {replyWindow?.lastInboundAt ? `، وآخر رسالة منه كانت ${formatTime(replyWindow.lastInboundAt)}` : ""}.
                انتظر حتى يراسلك من جديد.
              </p>
            )}
          </div>
        ) : null}
      </article>
    </section>
  );
}
