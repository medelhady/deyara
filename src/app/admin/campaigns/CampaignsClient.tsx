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

/**
 * The way out of a video WhatsApp will not take, added to the refusal itself.
 *
 * Every one of these failures -- too big, H.265, an odd container -- has the same fix, and it needs
 * no software and no computer: WhatsApp itself transcodes and compresses anything sent through it.
 * Telling someone their file is 42 megabytes and stopping there leaves them stuck with a video they
 * cannot use.
 */
const videoHint =
  "أسهل حل وبلا برامج: أرسل الفيديو لنفسك على واتساب، ثم نزّله من المحادثة وارفع النسخة الجديدة — واتساب يحوّله إلى H.264 ويصغّر حجمه تلقائيًا.";

function withHint(error: string, flagged?: boolean) {
  return flagged ? `${error} ${videoHint}` : error;
}

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
  /**
   * The upload speaks for itself, under the file input.
   *
   * A refusal shown at the top of the page is a refusal nobody reads: the eye is on the button it
   * just pressed, three panels down. A video was rejected, the message scrolled off above, and the
   * campaign was saved with no video at all -- answering every marketer with text alone.
   */
  const [videoNote, setVideoNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState<string | null>(null);
  const [testSteps, setTestSteps] = useState<{ id: string; lines: string[] } | null>(null);
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
    setVideoNote(null);

    try {
      const slotResponse = await fetch("/api/admin/campaigns/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The name travels too: a file picked on Windows or from a phone can arrive with no type at
        // all, and the extension is then the only evidence of what it is.
        body: JSON.stringify({ contentType: file.type, size: file.size, name: file.name })
      });
      const slot = await slotResponse.json();

      if (!slotResponse.ok) {
        setVideoNote({ kind: "error", text: withHint(slot.error ?? "تعذر رفع الفيديو.", slot.hint) });
        return;
      }

      const upload = await fetch(slot.url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file
      });

      if (!upload.ok) {
        /**
         * The storage server's own words, not ours.
         *
         * "Could not upload" says nothing that can be acted on -- a rejected key, a blocked request
         * and a dropped connection all look the same from here, and only the status and the body
         * tell them apart.
         */
        const detail = (await upload.text().catch(() => "")).slice(0, 200);

        setVideoNote({
          kind: "error",
          text: `تعذر رفع الفيديو إلى المخزن (${upload.status}). ${detail}`
        });
        return;
      }

      const verifyResponse = await fetch("/api/admin/campaigns/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "verify", path: slot.path })
      });
      const verified = await verifyResponse.json();

      if (!verifyResponse.ok) {
        setNote({
          kind: "error",
          text: withHint(verified.error ?? "الفيديو غير صالح للإرسال عبر واتساب.", verified.hint)
        });
        return;
      }

      setDraft((current) => ({ ...current, videoPath: slot.path }));
      /**
       * Uploaded is not saved, and that gap is where the video was being lost.
       *
       * The file is in storage and the chip appears, but nothing links it to a campaign until the
       * form is saved -- so a video uploaded and left there answers nobody, and the row goes on
       * sending text alone.
       */
      setVideoNote({
        kind: "ok",
        text: "✅ الفيديو جاهز — لن يُحفظ حتى تضغط زر الحفظ بالأسفل."
      });
    } catch (error) {
      // A thrown request leaves no response to read, and without this the box simply stops with no
      // word at all -- which is indistinguishable from a button that does nothing.
      setVideoNote({
        kind: "error",
        text: `انقطع الرفع: ${error instanceof Error ? error.message : String(error)}`
      });
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

  /**
   * The campaign sent for real, to a number the admin is holding.
   *
   * A video that does not arrive leaves nothing behind to inspect -- Meta accepts the send and
   * decides afterwards -- so the only way to know is to send one and be told each step: what the
   * file is, whether it went as a video or fell back to a link, and why.
   */
  async function test(id: string) {
    setTesting(id);
    setTestSteps(null);
    setNote(null);

    try {
      const response = await fetch("/api/admin/campaigns/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, phone: testPhone })
      });
      const data = await response.json();

      setTestSteps({ id, lines: data.steps ?? [] });

      if (!response.ok) {
        setNote({ kind: "error", text: data.error ?? "تعذرت التجربة." });
      }
    } finally {
      setTesting(null);
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

        <div className="campaign-video-block">
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
              اختياري. MP4 بترميز H.264 وأقل من 16 ميجابايت — وهذا ما نفحصه قبل القبول. {videoHint}
            </span>
          )}
        </div>

        {videoNote ? (
          <p className={videoNote.kind === "ok" ? "reply-ok" : "auth-error"}>{videoNote.text}</p>
        ) : null}
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

        <div className="row-actions">
          <label className="campaign-check">
            <span>رقم التجربة</span>
            <input
              inputMode="numeric"
              placeholder="22248404037"
              value={testPhone}
              onChange={(event) => setTestPhone(event.target.value)}
            />
          </label>
          {/* The 24-hour rule applies to this as to every other message the bot sends. */}
          <span className="amount-note">
            اكتب رقمك ثم اضغط «جرّب» على أي حملة — يصلك ما يصل المستخدم تمامًا. راسل البوت من هذا الرقم أولًا حتى تفتح نافذة الـ 24 ساعة.
          </span>
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
                {campaign.videoPath ? (
                  <span className="demand-chip">🎥 فيديو</span>
                ) : (
                  // Said out loud: an empty space reads as "video attached" to anyone who just
                  // uploaded one, and that is exactly how a campaign kept answering with text.
                  <span className="demand-chip is-missing">بلا فيديو</span>
                )}
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
                  onClick={() => {
                    if (
                      draft.videoPath &&
                      draft.videoPath !== campaign.videoPath &&
                      !window.confirm("رفعت فيديو ولم تحفظه. الانتقال لحملة أخرى يُلغيه. تكمل؟")
                    ) {
                      return;
                    }

                    setVideoNote(null);
                    setDraft({
                      id: campaign.id,
                      name: campaign.name,
                      keywords: campaign.keywords.join("، "),
                      replyText: campaign.replyText,
                      videoPath: campaign.videoPath,
                      active: campaign.active
                    });
                  }}
                >
                  ✏️ عدّل
                </button>
                <button className="button secondary" type="button" onClick={() => void toggle(campaign)}>
                  {campaign.active ? "⏸ أوقف" : "▶ شغّل"}
                </button>
                <button className="button secondary" type="button" onClick={() => void remove(campaign)}>
                  🗑 احذف
                </button>
                <button
                  className="button secondary"
                  type="button"
                  disabled={testing === campaign.id || !testPhone.trim()}
                  onClick={() => void test(campaign.id)}
                >
                  {testing === campaign.id ? "جارٍ الإرسال..." : "📤 جرّب"}
                </button>
              </div>

              {testSteps?.id === campaign.id ? (
                <div className="campaign-steps">
                  {testSteps.lines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
