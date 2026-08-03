"use client";

import { useState } from "react";

type ChatMessage = {
  direction: "inbound" | "outbound";
  body: string;
  intent?: string;
};

const examples = [
  "عندي شقة للإيجار",
  "تفرغ زينة",
  "3500",
  "قرب المستشفى الإسباني",
  "نعم",
  "لا",
  "طلب تواصل",
  "أريد شقة في تفرغ زينة بحد أقصى 2500"
];

export function SimulatorClient() {
  const [phone, setPhone] = useState("whatsapp:+22200000000");
  const [body, setBody] = useState(examples[0]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);

  async function sendMessage(options?: { media?: Array<{ url: string; contentType: string }>; label?: string }) {
    if (!body.trim() && !options?.media?.length) {
      return;
    }

    setIsSending(true);
    const inboundBody = options?.label ?? body;
    setMessages((current) => [...current, { direction: "inbound", body: inboundBody }]);

    try {
      const response = await fetch("/api/mock/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: phone,
          body,
          media: options?.media ?? []
        })
      });
      const data = await response.json();

      setMessages((current) => [
        ...current,
        { direction: "outbound", body: data.reply ?? "حدث خطأ في الرد.", intent: data.intent }
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="simulator">
      <section className="panel">
        <h2>محاكاة واتساب</h2>
        <label>
          رقم المستخدم
          <input value={phone} onChange={(event) => setPhone(event.target.value)} />
        </label>
        <label>
          الرسالة
          <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} />
        </label>
        <div className="chips">
          {examples.map((example) => (
            <button type="button" key={example} onClick={() => setBody(example)}>
              {example}
            </button>
          ))}
        </div>
        <button className="button" type="button" onClick={() => sendMessage()} disabled={isSending}>
          {isSending ? "جار الإرسال..." : "إرسال للبوت"}
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() =>
            sendMessage({
              label: "تم إرسال فيديو تجريبي",
              media: [
                {
                  url: "https://example.com/mock-property-video.mp4",
                  contentType: "video/mp4"
                }
              ]
            })
          }
          disabled={isSending}
        >
          إرسال فيديو تجريبي
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() =>
            sendMessage({
              label: "تم إرسال إيصال دفع تجريبي",
              media: [
                {
                  url: "https://example.com/mock-payment-receipt.jpg",
                  contentType: "image/jpeg"
                }
              ]
            })
          }
          disabled={isSending}
        >
          إرسال إيصال تجريبي
        </button>
      </section>

      <section className="phone-preview" aria-label="WhatsApp conversation preview">
        {messages.length === 0 ? (
          <p className="empty">ابدأ برسالة لاختبار فهم البوت.</p>
        ) : (
          messages.map((message, index) => (
            <article className={`bubble ${message.direction}`} key={`${message.direction}-${index}`}>
              <p>{message.body}</p>
              {message.intent ? <span>{message.intent}</span> : null}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
