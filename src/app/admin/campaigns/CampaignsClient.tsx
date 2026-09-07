"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Campaign = {
  id: string;
  name: string;
  keywords: string[];
  replyText: string;
  videoPath: string | null;
  active: boolean;
  hits: number;
  lastHitAt: string | null;
};

type Draft = {
  id?: string;
  name: string;
  keywords: string;
  replyText: string;
  videoPath: string | null;
  active: boolean;
};

const emptyDraft: Draft = { name: "", keywords: "", replyText: "", videoPath: null, active: true };

function formatWhen(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ar", { dateStyle: "short", timeStyle: "short" });
}

/**
 * The answers for whoever is not renting a house.
 *
 * An advert goes out to marketers or merchants naming a word; whoever writes that word gets the
 * explanation the advert promised. Both halves live here -- the word and the answer -- because they
 * are one decision, and splitting them across a dictionary and a message list is how a live advert
 * ends up pointing at nothing.
 */
export function CampaignsClient() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [message, setMessage] = useState("جار التحميل...");
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    const response = await fetch(`/api/admin/campaigns?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();

    setCampaigns(data.campaigns ?? []);
    setMessage(data.error ?? ((data.campaigns ?? []).length ? "" : "لا توجد حملات بعد."));
  }

  useEffect(() => {
    void load();
  }, []);

  /**
   * The file goes straight to storage, not through the dashboard.
   *
   * A serverless request body is capped far below the 16 megabytes WhatsApp carries, so a video sent
   * through the app would be refused at a size WhatsApp would have delivered. The app hands out a
   * signed slot, the browser uploads into it, and the server then reads the file back and checks it
   * -- an H.265 export is accepted by Meta and silently never delivered, and the only place to catch
   * that is here, while there is still someone to tell.
   */
  async function upload(file: File) {
    setUploading(true);
    setNote(null);

    try {
      const slotResponse = await fetch("/api/admin/campaigns/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type, size: file.size })
      });
      const slot = await slotResponse.json();

      if (!slotResponse.ok) {
        setNote({ kind: "error", text: slot.error ?? "تعذر رفع الفيديو." });
        return;
      }

      const upload = await fetch(slot.url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file
      });

      if (!upload.ok) {
        setNote({ kind: "error", text: "تعذر رفع الفيديو إلى المخزن. تحقق من الاتصال وأعد المحاولة." });
        return;
      }

      const verifyResponse = await fetch("/api/admin/campaigns/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "verify", path: slot.path })
      });
      const verified = await verifyResponse.json();

      if (!verifyResponse.ok) {
        setNote({ kind: "error", text: verified.error ?? "الفيديو غير صالح للإرسال عبر واتساب." });
        return;
      }

      setDraft((current) => ({ ...current, videoPath: slot.path }));
      setNote({ kind: "ok", text: "✅ الفيديو جاهز للإرسال." });
    } finally {
      setUploading(false);

      if (fileInput.current) {
        fileInput.current.value = "";
      }
    }
  }

  async function save() {
    setSaving(true);
    setNote(null);

    try {
      const response = await fetch("/api/admin/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      const data = await response.json();

      await load();

      // After the reload: load() rewrites the message line, and a confirmation announced before it
      // was erased a moment later.
      if (!response.ok) {
        setNote({ kind: "error", text: data.error ?? "تعذر الحفظ." });
        return;
      }

      setDraft(emptyDraft);
      setNote({ kind: "ok", text: "✅ حُفظت الحملة، وتعمل خلال نصف دقيقة." });
    } finally {
      setSaving(false);
    }
  }

  async function toggle(campaign: Campaign) {
    await fetch("/api/admin/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: campaign.id,
        name: campaign.name,
        keywords: campaign.keywords.join("، "),
        replyText: campaign.replyText,
        videoPath: campaign.videoPath,
        active: !campaign.active
      })
    });

    await load();
  }

  async function remove(campaign: Campaign) {
    if (!window.confirm(`حذف «${campaign.name}» نهائيًا؟ الإيقاف يكفي إن كنت ستعيدها لاحقًا.`)) {
      return;
    }

    const response = await fetch(`/api/admin/campaigns/${campaign.id}`, { method: "DELETE" });
    const data = await response.json();

    await load();

    if (!response.ok) {
      setNote({ kind: "error", text: data.error ?? "تعذر الحذف." });
    }
  }

  const totalHits = useMemo(
    () => campaigns.reduce((sum, campaign) => sum + campaign.hits, 0),
    [campaigns]
  );

  return (
    <>
      <section className="panel">
        <p>
          الحملة كلمة ورد. تكتب الكلمة في إعلانك على فيسبوك أو تيك توك، ومن يرسلها للبوت يصله الرد
          فورًا — فيديو تشرح فيه آلية العمل، أو نص، أو الاثنان معًا. تعمل مع كل المستخدمين، ولا تغيّر
          شيئًا في محادثة من كان يسجّل طلبه.
        </p>
        {note ? <p className={note.kind === "ok" ? "reply-ok" : "auth-error"}>{note.text}</p> : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{draft.id ? "تعديل حملة" : "حملة جديدة"}</p>
            <h2>{draft.name.trim() || "بلا اسم"}</h2>
          </div>
          {draft.id ? (
            <button className="button secondary" type="button" onClick={() => setDraft(emptyDraft)}>
              إلغاء التعديل
            </button>
          ) : null}
        </div>

        <div className="settings-grid">
          <label className="setting-field">
            <span>اسم الحملة</span>
            <input
              type="text"
              placeholder="إعلان التجار"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <small>لك أنت، لا يصل المستخدم.</small>
          </label>

          <label className="setting-field">
            <span>كلمات التشغيل</span>
            <input
              type="text"
              placeholder="تاجر، تجار، شراكة"
              value={draft.keywords}
              onChange={(event) => setDraft({ ...draft, keywords: event.target.value })}
            />
            {/* The one mistake that turns a campaign into a fault: a word people write for other
                reasons answers renters with an advert. */}
            <small>
              افصل بينها بفاصلة. يفهمها البوت ولو كُتبت بخطأ بسيط. تجنّب الكلمات العامة مثل «دار» أو
              «كراء» — تلتقط رسائل ليست للإعلان.
            </small>
          </label>
        </div>

        <label className="setting-field campaign-reply">
          <span>نص الرد</span>
          <textarea
            rows={4}
            placeholder="أهلًا بك 👋 هذه آلية عملنا مع الشركاء..."
            value={draft.replyText}
            onChange={(event) => setDraft({ ...draft, replyText: event.target.value })}
          />
        </label>

        <div className="row-actions campaign-video">
          <strong>فيديو الرد</strong>
          <input
            ref={fileInput}
            type="file"
            accept="video/mp4,video/*"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];

              if (file) {
                void upload(file);
              }
            }}
          />
          {uploading ? <span className="amount-note">جارٍ الرفع والفحص...</span> : null}
          {draft.videoPath ? (
            <>
              <span className="demand-tag is-owner">🎥 فيديو مرفق</span>
              <button
                className="button secondary"
                type="button"
                onClick={() => setDraft({ ...draft, videoPath: null })}
              >
                أزل الفيديو
              </button>
            </>
          ) : (
            <span className="amount-note">
              اختياري. MP4 بترميز H.264 وأقل من 16 ميجابايت — وهذا ما نفحصه قبل القبول.
            </span>
          )}
        </div>

        <div className="row-actions">
          <label className="campaign-check">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
            />
            <span>تعمل الآن</span>
          </label>
          <button className="button" type="button" disabled={saving} onClick={() => void save()}>
            {saving ? "جارٍ الحفظ..." : draft.id ? "احفظ التعديل" : "أضف الحملة"}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">الحملات</p>
            <h2>
              {campaigns.length} حملة — {totalHits} وصلتهم
            </h2>
          </div>
        </div>

        {message ? <p>{message}</p> : null}

        <div className="compact-list">
          {campaigns.map((campaign) => (
            <article className="demand-row" key={campaign.id}>
              <div className="demand-row-head">
                <span className={campaign.active ? "demand-tag is-owner" : "demand-tag"}>
                  {campaign.active ? "▶ تعمل" : "⏸ موقوفة"}
                </span>
                <strong className="demand-area">{campaign.name}</strong>
                {campaign.videoPath ? <span className="demand-chip">🎥 فيديو</span> : null}
                {/* The count is the whole feedback loop of an advert: a word nobody writes and a
                    word nobody sees look identical without it. */}
                <span className="demand-chip">{campaign.hits} وصلتهم</span>
                {campaign.lastHitAt ? <span className="demand-when">آخرها {formatWhen(campaign.lastHitAt)}</span> : null}
              </div>

              <p className="demand-said">
                {campaign.keywords.map((keyword) => `«${keyword}»`).join(" · ")}
              </p>

              {campaign.replyText ? <p className="demand-said">{campaign.replyText}</p> : null}

              <div className="demand-row-foot">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() =>
                    setDraft({
                      id: campaign.id,
                      name: campaign.name,
                      keywords: campaign.keywords.join("، "),
                      replyText: campaign.replyText,
                      videoPath: campaign.videoPath,
                      active: campaign.active
                    })
                  }
                >
                  ✏️ عدّل
                </button>
                <button className="button secondary" type="button" onClick={() => void toggle(campaign)}>
                  {campaign.active ? "⏸ أوقف" : "▶ شغّل"}
                </button>
                <button className="button secondary" type="button" onClick={() => void remove(campaign)}>
                  🗑 احذف
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
