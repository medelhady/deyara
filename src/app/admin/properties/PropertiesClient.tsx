"use client";

import { useEffect, useState } from "react";

type Property = {
  id: string;
  owner_phone: string;
  type: string | null;
  area: string | null;
  landmark: string | null;
  price: number | null;
  rooms: number | null;
  status: string;
  created_at: string;
};

export function PropertiesClient() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [message, setMessage] = useState("جار تحميل العقارات...");

  async function loadProperties() {
    const response = await fetch(`/api/admin/properties?t=${Date.now()}`, {
      cache: "no-store"
    });
    const data = await response.json();

    if (data.mode === "mock") {
      setMessage("Supabase غير مربوط بعد. بعد إضافة المفاتيح ستظهر العقارات هنا.");
      setProperties([]);
      return;
    }

    setProperties(data.properties ?? []);
    setMessage((data.properties ?? []).length ? "" : "لا توجد عقارات حتى الآن.");
  }

  async function updateStatus(id: string, status: "active" | "rejected") {
    const response = await fetch(`/api/admin/properties/${id}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status })
    });

    if (!response.ok) {
      const data = await response.json();
      setMessage(data.error ?? "تعذر تحديث العقار.");
      return;
    }

    await loadProperties();
  }

  useEffect(() => {
    void loadProperties();
  }, []);

  return (
    <section className="list-panel">
      {message ? <p>{message}</p> : null}
      {properties.map((property) => (
        <article className="property-row" key={property.id}>
          <div>
            <h2>
              {property.type ?? "عقار"} في {property.area ?? "منطقة غير محددة"}
            </h2>
            <p>السعر: {property.price ?? "غير محدد"}</p>
            <p>المعلم القريب: {property.landmark ?? "غير محدد"}</p>
            <p>رقم المؤجر: {property.owner_phone}</p>
            <p>الحالة: {property.status}</p>
          </div>
          <div className="row-actions">
            <button type="button" onClick={() => updateStatus(property.id, "active")}>
              موافقة
            </button>
            <button type="button" onClick={() => updateStatus(property.id, "rejected")}>
              رفض
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
