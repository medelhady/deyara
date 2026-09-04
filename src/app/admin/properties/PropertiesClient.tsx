"use client";

import { useEffect, useMemo, useState } from "react";

type Property = {
  id: string;
  property_code: string | null;
  owner_phone: string;
  type: string | null;
  area: string | null;
  landmark: string | null;
  price: number | null;
  rooms: number | null;
  /** Set by the owner while listing. 0 means none; null means the listing predates the question. */
  office_commission: number | null;
  status: string;
  created_at: string;
  media?: Array<{ type: string; url: string | null; contentType: string | null }>;
};

type DeleteOutcome = {
  id: string;
  code: string;
  deleted: boolean;
  reason?: string;
};

const statusLabels: Record<string, string> = {
  all: "الكل",
  pending_review: "قيد المراجعة",
  active: "نشط",
  rejected: "مرفوض",
  hidden: "مخفي",
  rented: "تم تأجيره"
};

const unknownArea = "بدون مقاطعة";

function formatPrice(price: number | null) {
  return price === null ? "غير محدد" : `${new Intl.NumberFormat("en-US").format(price)} أوقية`;
}

function PropertyVideo({ media, startOpen }: { media?: Property["media"]; startOpen: boolean }) {
  // Approved listings keep the video folded away: it was already watched to approve them, and it is
  // the heaviest thing on the page. A listing waiting for review opens straight to it.
  const [open, setOpen] = useState(startOpen);
  const video = media?.find((item) => item.type === "video" && item.url);

  if (!video?.url) {
    return <p className="media-missing">🎥 لا يوجد فيديو محفوظ لهذا الإعلان.</p>;
  }

  if (!open) {
    return (
      <button className="log-toggle" type="button" onClick={() => setOpen(true)}>
        ▸ 🎥 عرض الفيديو
      </button>
    );
  }

  return (
    <div className="property-video">
      <button className="log-toggle" type="button" onClick={() => setOpen(false)}>
        ▾ 🎥 إخفاء الفيديو
      </button>
      <video src={video.url} controls preload="metadata" playsInline />
      <a href={video.url} target="_blank" rel="noreferrer">
        فتح الفيديو في نافذة جديدة
      </a>
    </div>
  );
}

export function PropertiesClient() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [message, setMessage] = useState("جار تحميل العقارات...");
  const [statusFilter, setStatusFilter] = useState("all");
  const [openAreas, setOpenAreas] = useState<Record<string, boolean>>({});
  const [openProperty, setOpenProperty] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [deleteReport, setDeleteReport] = useState<DeleteOutcome[]>([]);
  const [videoReport, setVideoReport] = useState<string[] | null>(null);
  const [checkingVideos, setCheckingVideos] = useState(false);
  const [probingId, setProbingId] = useState<string | null>(null);

  /**
   * Runs one listing's video through the whole path to the admin's own phone.
   *
   * The failure this diagnoses is invisible everywhere else -- Meta accepts a link-based send before
   * it fetches the link -- so the only way to learn what actually happens is to make the real call
   * and read back what Meta said.
   */
  async function probeVideo(id: string, reference: string) {
    setProbingId(id);
    setVideoReport(null);

    try {
      const response = await fetch("/api/admin/video-health/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: id })
      });
      const data = await response.json();

      if (!response.ok) {
        setVideoReport([`⚠️ ${data.error ?? "تعذر الفحص."}`]);
        return;
      }

      const steps = (data.steps ?? []) as Array<{ name: string; ok: boolean; detail: string }>;

      setVideoReport([
        `تشخيص فيديو الإعلان ${reference} — أُرسل إلى ${data.target}`,
        ...steps.map((step) => `${step.ok ? "✅" : "⚠️"} ${step.name}: ${step.detail}`)
      ]);
    } finally {
      setProbingId(null);
    }
  }

  /**
   * Asks which active listings still have a playable video.
   *
   * A dead stored URL is invisible from every screen but the renter's: WhatsApp accepts the send and
   * drops it, so nothing is logged and nobody complains -- they just leave.
   */
  async function checkVideos() {
    setCheckingVideos(true);
    setVideoReport(null);

    try {
      const response = await fetch("/api/admin/video-health", { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        setVideoReport([`⚠️ ${data.error ?? "تعذر الفحص."}`]);
        return;
      }

      const broken = (data.broken ?? []) as Array<{ code: string; area: string | null; ownerPhone: string; reason: string }>;
      const missing = (data.missing ?? []) as Array<{ code: string; area: string | null; ownerPhone: string }>;

      if (broken.length === 0 && missing.length === 0) {
        setVideoReport([`✅ فُحص ${data.checked} إعلانًا نشطًا، وكل الفيديوهات تعمل.`]);
        return;
      }

      setVideoReport([
        `فُحص ${data.checked} إعلانًا نشطًا.`,
        ...broken.map((item) => `⚠️ ${item.code} — ${item.area ?? "بلا مقاطعة"} — ${item.ownerPhone}: ${item.reason}`),
        ...missing.map((item) => `🎥 ${item.code} — ${item.area ?? "بلا مقاطعة"} — ${item.ownerPhone}: لا يوجد فيديو محفوظ.`)
      ]);
    } finally {
      setCheckingVideos(false);
    }
  }

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

  const statusDone: Record<string, string> = {
    active: "تم نشر الإعلان وأُبلغ المؤجر",
    rejected: "تم رفض الإعلان وأُبلغ المؤجر، ولم تُخصم منه أوقية",
    hidden: "تم إخفاء الإعلان من نتائج البحث",
    rented: "تم وسم الإعلان كمؤجَّر وأُبلغ من كانوا ينتظرونه"
  };

  async function updateStatus(id: string, status: "active" | "rejected" | "hidden" | "rented") {
    // Without a busy id the buttons stayed live through the request, so a second tap on a slow
    // connection sent the whole thing twice.
    if (busyId) {
      return;
    }

    const property = properties.find((item) => item.id === id);
    const label = property?.property_code ?? id.slice(0, 8);

    setBusyId(id);
    setNotice(null);

    try {
      const response = await fetch(`/api/admin/properties/${id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status })
      });

      if (!response.ok) {
        const data = await response.json();
        setNotice({ kind: "error", text: data.error ?? "تعذر تحديث العقار." });
        return;
      }

      // The card collapses back into the list on success, which by itself looks the same as a tap
      // that did nothing.
      setNotice({ kind: "ok", text: `${statusDone[status]} — إعلان ${label}.` });
      setMessage("");
      await loadProperties();
    } finally {
      setBusyId(null);
    }
  }

  async function deleteProperty(id: string, reference: string) {
    if (busyId) {
      return;
    }

    const confirmed = window.confirm(
      `حذف الإعلان ${reference} نهائيًا؟\n\n` +
        "يُحذف معه الفيديو والصور، ولا يمكن استرجاعه.\n" +
        "إن كنت تريد إخفاءه من البحث فقط، استخدم زر إخفاء."
    );

    if (!confirmed) {
      return;
    }

    setBusyId(id);
    setNotice(null);

    try {
      const response = await fetch(`/api/admin/properties/${id}`, { method: "DELETE" });
      const data = await response.json();

      if (!response.ok) {
        setNotice({ kind: "error", text: data.error ?? "تعذر حذف الإعلان." });
        return;
      }

      setNotice({ kind: "ok", text: `تم حذف الإعلان ${reference} نهائيًا.` });
      await loadProperties();
    } finally {
      setBusyId(null);
    }
  }

  async function deleteSelected() {
    if (deleting) {
      return;
    }

    const confirmed = window.confirm(
      `حذف ${selected.length} إعلان نهائيًا؟\n\n` +
        "يُحذف معها الفيديو والصور، ولا يمكن استرجاعها.\n" +
        "أي إعلان طلب مستأجرٌ رقم مالكه سيُتخطى مع بيان السبب."
    );

    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setNotice(null);
    setDeleteReport([]);

    try {
      const response = await fetch("/api/admin/properties/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected })
      });
      const data = await response.json();

      if (!response.ok) {
        setNotice({ kind: "error", text: data.error ?? "تعذر الحذف." });
        return;
      }

      const results = (data.results ?? []) as DeleteOutcome[];
      const removed = results.filter((result) => result.deleted).length;

      // Only the ones that survived stay ticked, so a second attempt after reading the reasons acts
      // on exactly what failed rather than on everything again.
      setSelected(results.filter((result) => !result.deleted).map((result) => result.id));
      setDeleteReport(results);
      setNotice({
        kind: removed === results.length ? "ok" : "error",
        text: `حُذف ${removed} من ${results.length} إعلان.`
      });
      await loadProperties();
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    void loadProperties();
  }, []);

  /**
   * Narrowing the filter must not leave rows ticked off-screen: the count in the bar would then
   * promise something different from what the list shows, and the delete would act on the promise.
   */
  useEffect(() => {
    setSelected([]);
    setDeleteReport([]);
  }, [statusFilter, search]);

  const counts = properties.reduce<Record<string, number>>(
    (current, property) => {
      current.all += 1;
      current[property.status] = (current[property.status] ?? 0) + 1;
      return current;
    },
    { all: 0 }
  );

  const visibleProperties = useMemo(() => {
    const byStatus =
      statusFilter === "all" ? properties : properties.filter((property) => property.status === statusFilter);

    const term = search.trim();

    if (!term) {
      return byStatus;
    }

    // Digits are matched against the digits of the owner's number, so a search works whether it is
    // typed as 22245678901, +222 45678901, or the tail of the number the admin happens to remember.
    const digits = term.replace(/\D/g, "");
    const text = term.toLowerCase();

    return byStatus.filter((property) => {
      const ownerDigits = (property.owner_phone ?? "").replace(/\D/g, "");

      return (
        (digits.length >= 3 && ownerDigits.includes(digits)) ||
        (property.property_code ?? "").toLowerCase().includes(text) ||
        (property.area ?? "").toLowerCase().includes(text) ||
        (property.landmark ?? "").toLowerCase().includes(text)
      );
    });
  }, [properties, statusFilter, search]);

  const areas = useMemo(() => {
    const grouped = new Map<string, Property[]>();

    for (const property of visibleProperties) {
      const area = property.area?.trim() || unknownArea;
      grouped.set(area, [...(grouped.get(area) ?? []), property]);
    }

    return Array.from(grouped.entries())
      .map(([area, items]) => ({
        area,
        items,
        pending: items.filter((item) => item.status === "pending_review").length
      }))
      .sort((first, second) => second.items.length - first.items.length);
  }, [visibleProperties]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggleOne(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function setMany(ids: string[], on: boolean) {
    setSelected((current) => {
      if (on) {
        return [...new Set([...current, ...ids])];
      }

      const dropped = new Set(ids);

      return current.filter((id) => !dropped.has(id));
    });
  }

  const allVisibleSelected =
    visibleProperties.length > 0 && visibleProperties.every((property) => selectedSet.has(property.id));

  return (
    <section className="list-panel">
      <input
        type="search"
        className="property-search"
        placeholder="ابحث برقم المؤجر أو رقم الإعلان أو المنطقة"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

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

      <div className="row-actions">
        <button className="button secondary" type="button" disabled={checkingVideos} onClick={() => void checkVideos()}>
          {checkingVideos ? "جارٍ فحص الفيديوهات..." : "🎥 افحص فيديوهات الإعلانات"}
        </button>
      </div>

      {videoReport ? (
        <div className="delete-report">
          {videoReport.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}

      {/* Scoped to what the filter and the search are showing, never to all fifty rows: the label
          says how many, so the number the admin agrees to is the number that goes. */}
      {visibleProperties.length > 0 ? (
        <label className="select-all-row">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={(event) => setMany(visibleProperties.map((property) => property.id), event.target.checked)}
          />
          تحديد كل المعروض ({visibleProperties.length})
        </label>
      ) : null}

      {selected.length > 0 ? (
        <div className="bulk-bar">
          <span>{selected.length} محدد</span>
          <button className="button" type="button" disabled={deleting} onClick={() => void deleteSelected()}>
            {deleting ? "جارٍ الحذف..." : "حذف المحدد نهائيًا"}
          </button>
          <button className="button secondary" type="button" disabled={deleting} onClick={() => setSelected([])}>
            إلغاء التحديد
          </button>
        </div>
      ) : null}

      {deleteReport.length > 0 ? (
        <div className="delete-report">
          {deleteReport.map((result) => (
            <p key={result.id}>
              {result.deleted ? "🗑" : "⚠️"} {result.code} {result.deleted ? "— حُذف" : `— لم يُحذف: ${result.reason}`}
            </p>
          ))}
        </div>
      ) : null}

      {/* Sticky: the card that was tapped can be far down a long list on a phone. */}
      {notice ? (
        <div className={`action-notice is-${notice.kind}`} role="status">
          <span>{notice.kind === "ok" ? "✅" : "⚠️"}</span>
          <p>{notice.text}</p>
          <button type="button" aria-label="إغلاق" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      ) : null}

      {search.trim() && areas.length === 0 ? <p>لا يوجد إعلان يطابق هذا البحث.</p> : null}

      {areas.map((group) => {
        // A search opens every group it matched: leaving them shut would show a list of area names
        // and no results, which reads as "nothing found".
        const isOpen = search.trim() ? true : openAreas[group.area] ?? false;

        const groupIds = group.items.map((item) => item.id);
        const pickedInGroup = groupIds.filter((id) => selectedSet.has(id)).length;

        return (
          <article className="area-group" key={group.area}>
            {/* The checkbox sits beside the fold button rather than inside it: nesting it would make
                every tick also open or shut the district. */}
            <div className="area-header-row">
              <input
                type="checkbox"
                aria-label={`تحديد كل عقارات ${group.area}`}
                checked={pickedInGroup === groupIds.length}
                ref={(element) => {
                  if (element) {
                    element.indeterminate = pickedInGroup > 0 && pickedInGroup < groupIds.length;
                  }
                }}
                onChange={(event) => setMany(groupIds, event.target.checked)}
              />
              <button
                className="area-header"
                type="button"
                onClick={() => setOpenAreas((current) => ({ ...current, [group.area]: !isOpen }))}
              >
                <span>
                  {isOpen ? "▾" : "▸"} 📍 {group.area}
                </span>
                <span className="area-counts">
                  {pickedInGroup > 0 ? `${pickedInGroup} محدد — ` : ""}
                  {group.items.length} عقار
                  {group.pending > 0 ? ` — ${group.pending} بانتظار المراجعة` : ""}
                </span>
              </button>
            </div>

            {isOpen
              ? group.items.map((property) => {
                  const expanded = openProperty === property.id;
                  const reference = property.property_code ?? property.id.slice(0, 8);

                  return (
                    <div
                      className={`property-entry${selectedSet.has(property.id) ? " is-selected" : ""}`}
                      key={property.id}
                    >
                      <div className="property-summary-row">
                        <input
                          type="checkbox"
                          aria-label={`تحديد ${reference}`}
                          checked={selectedSet.has(property.id)}
                          onChange={() => toggleOne(property.id)}
                        />
                        <button
                          className="property-summary"
                          type="button"
                          onClick={() => setOpenProperty(expanded ? null : property.id)}
                        >
                          <span>
                            {expanded ? "▾" : "▸"} *{reference}* — {property.type ?? "عقار"} —{" "}
                            {formatPrice(property.price)}
                          </span>
                          <span className="area-counts">{statusLabels[property.status] ?? property.status}</span>
                        </button>
                      </div>

                      {expanded ? (
                        <div className="property-detail">
                          <p>المعلم القريب: {property.landmark ?? "غير محدد"}</p>
                          <p>الغرف: {property.rooms ?? "غير محدد"}</p>
                          {/* Three states, not two: an owner who said "no commission" and a listing
                              published before the question existed are different facts, and only the
                              second is something to go and ask about. */}
                          <p>
                            عمولة المكتب:{" "}
                            {property.office_commission === null
                              ? "لم يُسأل عنها — إعلان قديم"
                              : property.office_commission === 0
                                ? "لا توجد"
                                : formatPrice(property.office_commission)}
                          </p>
                          <p>رقم المؤجر: {property.owner_phone}</p>
                          <PropertyVideo media={property.media} startOpen={property.status === "pending_review"} />
                          {/* The label carries the busy state: a disabled button alone is easy to
                              miss on a phone, so a working tap looks like one that did nothing. */}
                          <div className="row-actions">
                            {(
                              [
                                { status: "active", label: "موافقة", busy: "جارٍ النشر..." },
                                { status: "rejected", label: "رفض", busy: "جارٍ الرفض..." },
                                { status: "hidden", label: "إخفاء", busy: "جارٍ الإخفاء..." },
                                { status: "rented", label: "تم تأجيره", busy: "جارٍ الحفظ..." }
                              ] as const
                            ).map((action) => (
                              <button
                                key={action.status}
                                type="button"
                                disabled={busyId === property.id}
                                onClick={() => void updateStatus(property.id, action.status)}
                              >
                                {busyId === property.id ? action.busy : action.label}
                              </button>
                            ))}
                            <button
                              type="button"
                              disabled={probingId === property.id}
                              onClick={() => void probeVideo(property.id, reference)}
                            >
                              {probingId === property.id ? "جارٍ الفحص..." : "🎥 جرّب إرسال الفيديو لرقمي"}
                            </button>
                            {/* Last, and visually apart: it is the only one of these that cannot be
                                undone. Hiding is the reversible option for everything else. */}
                            <button
                              className="danger-action"
                              type="button"
                              disabled={busyId === property.id}
                              onClick={() => void deleteProperty(property.id, reference)}
                            >
                              {busyId === property.id ? "..." : "حذف نهائي"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              : null}
          </article>
        );
      })}

      {!message && areas.length === 0 ? <p>لا توجد عقارات ضمن هذا الفلتر.</p> : null}
    </section>
  );
}
