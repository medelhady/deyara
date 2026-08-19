"use client";

import { useEffect, useMemo, useState } from "react";

type Thread = {
  phone: string;
  lastMessage: string;
  lastDirection: string;
  lastAt: string;
  count: number;
};

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
              <strong>{thread.phone.replace("whatsapp:", "")}</strong>
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
      </article>
    </section>
  );
}
