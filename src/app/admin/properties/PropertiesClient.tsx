"use client";

import { useEffect, useState } from "react";

type Property = {
  id: string;
  property_code: string | null;
  owner_phone: string;
  type: string | null;
  area: string | null;
  landmark: string | null;
  price: number | null;
  rooms: number | null;
  status: string;
  created_at: string;
};

const statusLabels: Record<string, string> = {
  all: "الكل",
  pending_review: "قيد المراجعة",
  active: "نشط",
  rejected: "مرفوض",
  hidden: "مخفي",
  rented: "تم تأجيره"
};

export function PropertiesClient() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [message, setMessage] = useState("جار تحميل العقارات...");
  const [statusFilter, setStatusFilter] = useState("all");

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

  async function updateStatus(id: string, status: "active" | "rejected" | "hidden" | "rented") {
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

  const counts = properties.reduce<Record<string, number>>(
    (current, property) => {
      current.all += 1;
      current[property.status] = (current[property.status] ?? 0) + 1;
      return current;
    },
    { all: 0 }
  );
  const visibleProperties =
    statusFilter === "all" ? properties : properties.filter((property) => property.status === statusFilter);

  return (
    <section className="list-panel">
      <div className="filters-bar">
        {Object.entries(statusLabels).map(([status, label]) => (
          <button
            className={statusFilter === status ? "active" : ""}
            type="button"
            key={status}
            onClick={() => setStatusFilter(status)}
          >
            {label} ({counts[status] ?? 0})
          </button>
        ))}
      </div>
      {message ? <p>{message}</p> : null}
      {visibleProperties.map((property) => (
        <article className="property-row" key={property.id}>
          <div>
            <h2>
              {property.type ?? "عقار"} في {property.area ?? "منطقة غير محددة"}
            </h2>
            <p>رقم الإعلان: {property.property_code ?? property.id.slice(0, 8)}</p>
            <p>السعر: {property.price ?? "غير محدد"}</p>
            <p>المعلم القريب: {property.landmark ?? "غير محدد"}</p>
            <p>رقم المؤجر: {property.owner_phone}</p>
            <p>الحالة: {statusLabels[property.status] ?? property.status}</p>
          </div>
          <div className="row-actions">
            <button type="button" onClick={() => updateStatus(property.id, "active")}>
              موافقة
            </button>
            <button type="button" onClick={() => updateStatus(property.id, "rejected")}>
              رفض
            </button>
            <button type="button" onClick={() => updateStatus(property.id, "hidden")}>
              إخفاء
            </button>
            <button type="button" onClick={() => updateStatus(property.id, "rented")}>
              تم تأجيره
            </button>
          </div>
        </article>
      ))}
      {!message && visibleProperties.length === 0 ? <p>لا توجد عقارات ضمن هذا الفلتر.</p> : null}
    </section>
  );
}
