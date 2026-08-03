"use client";

import { useEffect, useState } from "react";

type ContactRequest = {
  id: string;
  renter_phone: string;
  owner_phone: string;
  status: string;
  fee_amount: number | null;
  created_at: string;
  properties?: {
    property_code?: string | null;
    type?: string | null;
    area?: string | null;
    price?: number | null;
    landmark?: string | null;
  } | null;
  payments?: Array<{
    id: string;
    receipt_image_url: string | null;
    status: string;
    created_at: string;
  }>;
};

export function ContactRequestsClient() {
  const [requests, setRequests] = useState<ContactRequest[]>([]);
  const [message, setMessage] = useState("جار تحميل طلبات التواصل...");

  async function loadRequests() {
    const response = await fetch(`/api/admin/contact-requests?t=${Date.now()}`, {
      cache: "no-store"
    });
    const data = await response.json();

    if (data.mode === "mock") {
      setMessage("Supabase غير مربوط بعد.");
      setRequests([]);
      return;
    }

    setRequests(data.contactRequests ?? []);
    setMessage((data.contactRequests ?? []).length ? "" : "لا توجد طلبات تواصل حتى الآن.");
  }

  async function updateStatus(id: string, status: "approved" | "rejected") {
    const response = await fetch(`/api/admin/contact-requests/${id}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status })
    });

    if (!response.ok) {
      const data = await response.json();
      setMessage(data.error ?? "تعذر تحديث طلب التواصل.");
      return;
    }

    await loadRequests();
  }

  useEffect(() => {
    void loadRequests();
  }, []);

  return (
    <section className="list-panel">
      {message ? <p>{message}</p> : null}
      {requests.map((request) => (
        <article className="property-row" key={request.id}>
          <div>
            <h2>طلب تواصل للعقار {request.properties?.property_code ?? request.id.slice(0, 8)}</h2>
            <p>
              العقار: {request.properties?.type ?? "عقار"} في {request.properties?.area ?? "غير محددة"}
            </p>
            <p>السعر: {request.properties?.price ?? "غير محدد"}</p>
            <p>المعلم: {request.properties?.landmark ?? "غير محدد"}</p>
            <p>رقم المستأجر: {request.renter_phone}</p>
            <p>رقم المؤجر: {request.owner_phone}</p>
            <p>الحالة: {request.status}</p>
            <p>الرسوم: {request.fee_amount ?? "غير محددة"}</p>
            <p>
              الإيصال:{" "}
              {request.payments?.[0]?.receipt_image_url ? (
                <a href={request.payments[0].receipt_image_url} target="_blank" rel="noreferrer">
                  فتح الإيصال
                </a>
              ) : (
                "لم يصل بعد"
              )}
            </p>
          </div>
          <div className="row-actions">
            <button type="button" onClick={() => updateStatus(request.id, "approved")}>
              قبول الدفع
            </button>
            <button type="button" onClick={() => updateStatus(request.id, "rejected")}>
              رفض
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
