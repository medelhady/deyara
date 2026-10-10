import type { IncomingWhatsAppMessage } from "@/lib/whatsapp/types";
import { getServiceSupabase } from "@/lib/supabase/server";
import { normalizeCampaignText } from "@/lib/campaigns";
import { deletePropertyMedia, propertyMediaBucket } from "@/lib/whatsapp/media";
import { notifyAdmins } from "@/lib/notify-admins";
import { setConversationState } from "./store";
import type { ConversationResult, ConversationState } from "./types";

/**
 * Wifi requests taken over WhatsApp.
 *
 * A customer who has seen the "ويفي" campaign writes "تقديم ويفي" and is asked, one at a time, for
 * the area, the name, the national ID, two phone numbers, the two codes printed on the Mauritel
 * device (one on top, one underneath) and a photo of the ID card and of the device. Everything is
 * then shown back in one message, and the customer either confirms or picks what to correct.
 *
 * A confirmed request is posted to the Wifi dashboard (/api/intake) and the admins are told on
 * WhatsApp. Off unless WIFI_INTAKE_URL and WIFI_INTAKE_KEY are both set, so shipping this file
 * changes nothing for a deployment that has not been wired to the dashboard yet.
 */

type StoredImage = { path: string; contentType: string };

type WifiField =
  | "region"
  | "name"
  | "national_id"
  | "phone1"
  | "phone2"
  | "code1"
  | "code2"
  | "id_card"
  | "mauritel";

// "offered": the customer has seen the wifi advert and is expected to answer "جاهز".
export type WifiStep = WifiField | "confirm" | "pick_edit" | "offered";

export type WifiState = {
  step: WifiStep;
  updatedAt: string;
  /** Set while one answer is being corrected from the summary, so the flow returns to it. */
  editing?: boolean;
  region?: string;
  name?: string;
  nationalId?: string;
  phone1?: string;
  /** Empty string means the customer said there is no second number. */
  phone2?: string;
  code1?: string;
  code2?: string;
  idCard?: StoredImage;
  mauritel?: StoredImage;
};

const FIELDS: Array<{ key: WifiField; label: string; question: string }> = [
  { key: "region", label: "المنطقة", question: "اكتب *المنطقة أو الحي* الذي تسكن فيه." },
  { key: "name", label: "الاسم", question: "اكتب *اسمك الكامل*." },
  { key: "national_id", label: "الرقم الوطني", question: "اكتب *الرقم الوطني* (أرقام فقط)." },
  { key: "phone1", label: "الهاتف الأول", question: "اكتب *رقم هاتفك الأول* (8 أرقام)." },
  {
    key: "phone2",
    label: "الهاتف الثاني",
    question: "اكتب *رقم الهاتف الثاني* (8 أرقام). وإذا لا يوجد اكتب: *لا يوجد*."
  },
  { key: "code1", label: "الكود العلوي", question: "اكتب *الكود الذي في أعلى* داية موريتل." },
  { key: "code2", label: "الكود السفلي", question: "اكتب *الكود الذي في أسفل* داية موريتل." },
  { key: "id_card", label: "صورة البطاقة", question: "أرسل الآن *صورة بطاقة التعريف* (صورة واضحة)." },
  {
    key: "mauritel",
    label: "صورة داية موريتل",
    question: "أرسل الآن *صورة داية موريتل* (يظهر فيها الكودان)."
  }
];

const STATUS_LABELS: Record<string, string> = {
  new: "جديد",
  account_created: "تم إنشاء الحساب",
  paid: "تم الدفع",
  done: "مكتمل",
  rejected: "مرفوض",
  // Stages used before the current ones.
  review: "قيد المراجعة",
  in_progress: "قيد التنفيذ"
};

// Written the way normalizeCampaignText leaves them: no hamza, ة read as ه.
const applyWords = ["تقديم", "تقدم", "قدم", "اقدم", "تسجيل", "سجل", "طلب", "اشتراك"];
const cancelWords = ["الغاء", "الغي", "خروج", "توقف"];
const yesTexts = ["1", "صحيح", "صح", "نعم", "تمام", "اكد", "تاكيد", "موافق", "ارسل"];
const editTexts = ["2", "تعديل", "عدل", "غلط", "خطا", "لا"];
const noSecondPhone = ["لا يوجد", "لايوجد", "ما عندي", "ماعندي", "لا", "تخطي", "بدون", "0"];

const flowTtlMs = 3 * 60 * 60 * 1000;
// How long after the advert a customer's "جاهز" still counts.
const offerTtlMs = 48 * 60 * 60 * 1000;

// "جاهز" on its own is an ordinary word, so it only starts the flow for someone who has just been
// shown the wifi advert. Written the way normalizeCampaignText leaves them (ة read as ه).
const readyTexts = ["جاهز", "جاهزه", "انا جاهز", "انا جاهزه", "جاهزين", "نحن جاهزين"];

function isReady(text: string, words: string[]) {
  return readyTexts.includes(text) || (mentionsWifi(text) && words.some((w) => w === "جاهز" || w === "جاهزه"));
}

// Where a customer is sent to ask about a request already made.
const contactLink = "https://wa.me/22234300253";

function mentionsWifi(text: string) {
  return /(ويفي|وايفي|وايفاي|واي فاي|wifi|wi fi)/.test(text);
}

/** People type their own numerals: ٠١٢٣ and ۰۱۲۳ are read as 0123. */
function latinDigits(value: string) {
  return value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function onlyDigits(value: string) {
  return latinDigits(value).replace(/\D/g, "");
}

function isConfigured() {
  return Boolean(process.env.WIFI_INTAKE_URL && process.env.WIFI_INTAKE_KEY);
}

function intakeUrl() {
  return `${(process.env.WIFI_INTAKE_URL ?? "").replace(/\/+$/, "")}/api/intake`;
}

function authHeaders() {
  return { Authorization: `Bearer ${process.env.WIFI_INTAKE_KEY}` };
}

function reply(text: string): ConversationResult {
  return { debugIntent: "intro", reply: text };
}

/** A Mauritanian number is eight digits, with or without the 222 in front. */
function readPhone(body: string) {
  let digits = onlyDigits(body);

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if (digits.length === 11 && digits.startsWith("222")) {
    digits = digits.slice(3);
  }

  return digits.length === 8 ? digits : null;
}

function extensionFor(contentType: string) {
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

function isImage(contentType: string) {
  return contentType.startsWith("image/") || contentType === "application/pdf";
}

/** Meta's media links expire within minutes and need the token, so the file is taken at once. */
async function downloadMedia(url: string) {
  const token = process.env.META_WHATSAPP_TOKEN;

  if (!token) {
    return null;
  }

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (!response.ok) {
    console.error("Wifi intake: failed to download media", response.status);
    return null;
  }

  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? ""
  };
}

/** Holds one picture in the private bucket until the whole request is confirmed. */
async function stashImage(media: { url: string; contentType: string }, phone: string, label: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return null;
  }

  const downloaded = await downloadMedia(media.url);

  if (!downloaded) {
    return null;
  }

  const contentType = downloaded.contentType || media.contentType;
  const path = `wifi/${onlyDigits(phone)}/${Date.now()}-${label}.${extensionFor(contentType)}`;

  const { error } = await supabase.storage.from(propertyMediaBucket).upload(path, downloaded.body, {
    contentType,
    upsert: false
  });

  if (error) {
    console.error("Wifi intake: failed to stash image", error);
    return null;
  }

  const stored: StoredImage = { path, contentType };

  return stored;
}

async function readImage(image: StoredImage) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.storage.from(propertyMediaBucket).download(image.path);

  if (error || !data) {
    return null;
  }

  return new Blob([await data.arrayBuffer()], { type: image.contentType });
}

async function discardImages(wifi: WifiState) {
  for (const image of [wifi.idCard, wifi.mauritel]) {
    if (image) {
      await deletePropertyMedia(image.path);
    }
  }
}

function valueOf(wifi: WifiState, field: WifiField) {
  switch (field) {
    case "region":
      return wifi.region;
    case "name":
      return wifi.name;
    case "national_id":
      return wifi.nationalId;
    case "phone1":
      return wifi.phone1;
    case "phone2":
      return wifi.phone2 === "" ? "لا يوجد" : wifi.phone2;
    case "code1":
      return wifi.code1;
    case "code2":
      return wifi.code2;
    case "id_card":
      return wifi.idCard ? "✅ تم الاستلام" : undefined;
    case "mauritel":
      return wifi.mauritel ? "✅ تم الاستلام" : undefined;
  }
}

function summary(wifi: WifiState) {
  const lines = FIELDS.map((field) => `• ${field.label}: ${valueOf(wifi, field.key) ?? "—"}`);

  return [
    "📋 *ملخص طلبك*",
    "",
    ...lines,
    "",
    "هل المعلومات صحيحة؟",
    "اكتب *1* للتأكيد وإرسال الطلب",
    "اكتب *2* لتعديل معلومة"
  ].join("\n");
}

function editMenu() {
  return [
    "أي معلومة تريد تعديلها؟ اكتب رقمها:",
    "",
    ...FIELDS.map((field, index) => `${index + 1}. ${field.label}`),
    "",
    "أو اكتب *رجوع* للعودة إلى الملخص."
  ].join("\n");
}

/** One typed answer, checked. Returns the cleaned value or the complaint to send back. */
function readTextAnswer(field: WifiField, body: string): { value: string } | { error: string } {
  const text = body.trim();

  switch (field) {
    case "region":
      return text.length >= 2 ? { value: text } : { error: "اكتب *اسم المنطقة أو الحي*." };

    case "name":
      return text.length >= 3 ? { value: text } : { error: "اكتب *اسمك الكامل* من فضلك (3 أحرف على الأقل)." };

    case "national_id": {
      const compact = latinDigits(text).replace(/[\s-]/g, "");

      return /^\d{8,13}$/.test(compact)
        ? { value: compact }
        : { error: "الرقم الوطني غير صحيح. اكتبه *أرقامًا فقط* من فضلك." };
    }

    case "phone1": {
      const phone = readPhone(text);

      return phone ? { value: phone } : { error: "الرقم غير صحيح. اكتب *8 أرقام* من فضلك." };
    }

    case "phone2": {
      if (noSecondPhone.includes(normalizeCampaignText(text))) {
        return { value: "" };
      }

      const phone = readPhone(text);

      return phone
        ? { value: phone }
        : { error: "الرقم غير صحيح. اكتب *8 أرقام*، أو اكتب *لا يوجد*." };
    }

    case "code1":
    case "code2": {
      const code = latinDigits(text).replace(/\s+/g, " ");

      return code.length >= 2 && code.length <= 30
        ? { value: code }
        : { error: "اكتب *الكود* كما هو مكتوب على الداية." };
    }

    default:
      return { error: "" };
  }
}

function withValue(wifi: WifiState, field: WifiField, value: string): WifiState {
  switch (field) {
    case "region":
      return { ...wifi, region: value };
    case "name":
      return { ...wifi, name: value };
    case "national_id":
      return { ...wifi, nationalId: value };
    case "phone1":
      return { ...wifi, phone1: value };
    case "phone2":
      return { ...wifi, phone2: value };
    case "code1":
      return { ...wifi, code1: value };
    case "code2":
      return { ...wifi, code2: value };
    default:
      return wifi;
  }
}

function questionFor(field: WifiField) {
  return FIELDS.find((item) => item.key === field)?.question ?? "";
}

/** After an answer: back to the summary when correcting, otherwise on to the next question. */
function advance(wifi: WifiState, field: WifiField): { wifi: WifiState; text: string } {
  if (wifi.editing) {
    const done: WifiState = { ...wifi, editing: undefined, step: "confirm" };

    return { wifi: done, text: `تم التعديل ✅\n\n${summary(done)}` };
  }

  const index = FIELDS.findIndex((item) => item.key === field);
  const next = FIELDS[index + 1];

  if (!next) {
    const done: WifiState = { ...wifi, step: "confirm" };

    return { wifi: done, text: summary(done) };
  }

  return { wifi: { ...wifi, step: next.key }, text: `تمام ✅\n\n${next.question}` };
}

/** Sends the confirmed request to the dashboard. */
async function submitRequest(phone: string, wifi: WifiState) {
  if (!wifi.idCard || !wifi.mauritel) {
    return { ok: false as const };
  }

  const idCard = await readImage(wifi.idCard);
  const mauritel = await readImage(wifi.mauritel);

  if (!idCard || !mauritel) {
    return { ok: false as const };
  }

  const form = new FormData();
  form.append("customer_name", wifi.name ?? "");
  form.append("national_id", wifi.nationalId ?? "");
  form.append("phone", wifi.phone1 ?? "");
  form.append("phone2", wifi.phone2 ?? "");
  form.append("code1", wifi.code1 ?? "");
  form.append("code2", wifi.code2 ?? "");
  form.append("region", wifi.region ?? "");
  form.append("whatsapp_number", onlyDigits(phone));
  form.append("id_card", idCard, `id-card.${extensionFor(wifi.idCard.contentType)}`);
  form.append("mauritel_copy", mauritel, `mauritel.${extensionFor(wifi.mauritel.contentType)}`);

  try {
    const response = await fetch(intakeUrl(), {
      method: "POST",
      headers: authHeaders(),
      body: form,
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      console.error("Wifi intake: dashboard refused the request", response.status, await response.text());
      return { ok: false as const };
    }

    const json = (await response.json()) as { request_number?: number };

    return { ok: true as const, number: json.request_number };
  } catch (error) {
    console.error("Wifi intake: could not reach the dashboard", error);
    return { ok: false as const };
  }
}

/** The admins are told on WhatsApp, with everything the customer wrote. A failure here is only logged. */
async function copyToAdmins(phone: string, wifi: WifiState, number: number | undefined) {
  try {
    await notifyAdmins([
      "📶 *طلب ويفي جديد من واتساب*",
      "",
      number ? `رقم الطلب: #${number}` : "",
      ...FIELDS.filter((field) => field.key !== "id_card" && field.key !== "mauritel").map(
        (field) => `${field.label}: ${valueOf(wifi, field.key) ?? "—"}`
      ),
      `واتساب العميل: +${onlyDigits(phone)}`,
      "",
      "الصور محفوظة في داشبورد الويفي."
    ].filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== "")));
  } catch (error) {
    console.error("Wifi intake: could not copy the request to the admins", error);
  }
}

async function statusReply(phone: string, state: ConversationState) {
  try {
    const response = await fetch(`${intakeUrl()}?phone=${onlyDigits(phone)}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      return reply("تعذّر الاطلاع على حالة طلبك الآن. حاول بعد قليل.");
    }

    const json = (await response.json()) as {
      requests?: Array<{ request_number: number; status: string; created_at: string }>;
    };
    const rows = json.requests ?? [];

    if (rows.length === 0) {
      await save(phone, state, { step: "offered", updatedAt: new Date().toISOString() });

      return reply("لا توجد طلبات ويفي مسجّلة على هذا الرقم.\n\nللتقديم اكتب: *جاهز*");
    }

    const lines = rows.map(
      (row) =>
        `• طلب *#${row.request_number}* — ${STATUS_LABELS[row.status] ?? row.status} (${row.created_at.slice(0, 10)})`
    );

    return reply(["📋 *طلباتك*", "", ...lines].join("\n"));
  } catch (error) {
    console.error("Wifi intake: status lookup failed", error);
    return reply("تعذّر الاطلاع على حالة طلبك الآن. حاول بعد قليل.");
  }
}

/**
 * Who may ask for a request by its number.
 *
 * The reply carries a customer's ID card, so it is answered only to the numbers listed in
 * WIFI_LOOKUP_NUMBERS (comma-separated, with or without 222). Empty means nobody.
 */
function canLookUp(phone: string) {
  const digits = onlyDigits(phone);
  const allowed = (process.env.WIFI_LOOKUP_NUMBERS ?? "")
    .split(/[,\s،;]+/)
    .map(onlyDigits)
    .filter((number) => number.length >= 8);

  return allowed.some((number) => digits === number || digits.endsWith(number) || number.endsWith(digits));
}

/**
 * "#12" or "طلب 12" / "طلب رقم 12". A bare number is deliberately not a request number: it is also
 * a price, an answer to a question, a phone digit.
 */
function readRequestNumber(body: string) {
  const text = latinDigits(body).trim();
  const match = text.match(/^#\s*(\d{1,7})$/) ?? text.match(/^(?:طلب|الطلب)\s*(?:رقم\s*)?#?\s*(\d{1,7})$/);
  const number = match ? Number(match[1]) : 0;

  return number > 0 ? number : null;
}

type LookedUpRequest = {
  request_number: number;
  status: string;
  customer_name: string | null;
  national_id: string | null;
  phone: string | null;
  phone2: string | null;
  code1: string | null;
  code2: string | null;
  region: string | null;
  attachments?: Array<{ type: string; name: string; url: string | null }>;
};

const ATTACHMENT_LABELS: Record<string, string> = {
  id_card: "بطاقة التعريف",
  mauritel_copy: "داية موريتل",
  electricity_bill: "فاتورة الكهرباء"
};

/** The short info of one request, and its pictures, for an allowed number that wrote "#12". */
async function requestReply(number: number): Promise<ConversationResult> {
  try {
    const response = await fetch(`${intakeUrl()}?number=${number}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      return reply("تعذّر جلب الطلب الآن. حاول بعد قليل.");
    }

    const json = (await response.json()) as { request?: LookedUpRequest | null };
    const row = json.request;

    if (!row) {
      return reply(`لا يوجد طلب برقم #${number}`);
    }

    const lines = [
      `📋 *طلب #${row.request_number}* — ${STATUS_LABELS[row.status] ?? row.status}`,
      "",
      row.customer_name,
      row.national_id,
      [row.phone, row.phone2].filter(Boolean).join(" - "),
      [row.code1, row.code2].filter(Boolean).join(" - "),
      row.region ? `المنطقة: ${row.region}` : ""
    ].filter((line): line is string => Boolean(line && line.trim()));

    const media: NonNullable<ConversationResult["media"]> = [];

    for (const file of row.attachments ?? []) {
      if (!file.url) {
        continue;
      }

      const label = `#${row.request_number} — ${ATTACHMENT_LABELS[file.type] ?? file.type}`;
      const isPdf = /\.pdf$/i.test(file.name ?? "");

      media.push(
        isPdf
          ? { kind: "document", url: file.url, label, fileName: file.name }
          : { kind: "image", url: file.url, label }
      );
    }

    return { debugIntent: "intro", reply: lines.join("\n"), media };
  } catch (error) {
    console.error("Wifi intake: request lookup failed", error);
    return reply("تعذّر جلب الطلب الآن. حاول بعد قليل.");
  }
}

async function save(phone: string, state: ConversationState, wifi: WifiState | undefined) {
  await setConversationState(phone, {
    ...state,
    wifi: wifi ? { ...wifi, updatedAt: new Date().toISOString() } : undefined
  });
}

/**
 * Handles one incoming message for the wifi flow.
 *
 * Returns null when the message has nothing to do with it, so everything else in the bot runs
 * exactly as before.
 */
export async function handleWifiIntake(
  message: IncomingWhatsAppMessage,
  initial: ConversationState
): Promise<ConversationResult | null> {
  if (!isConfigured()) {
    return null;
  }

  // A request looked up by its number answers at once, even in the middle of another conversation.
  if (canLookUp(message.from)) {
    const looked = readRequestNumber(message.body);

    if (looked) {
      return requestReply(looked);
    }
  }

  const phone = message.from;
  const text = normalizeCampaignText(latinDigits(message.body));
  const words = text.split(" ").filter(Boolean);
  let state = initial;
  let wifi = state.wifi;

  // A flow left open for hours is dropped, and the message is read as if it had never existed.
  if (wifi && wifi.step !== "offered" && Date.now() - new Date(wifi.updatedAt).getTime() > flowTtlMs) {
    await discardImages(wifi);
    await save(phone, state, undefined);
    state = { ...state, wifi: undefined };
    wifi = undefined;
  }

  // An advert seen long ago no longer counts.
  if (wifi && wifi.step === "offered" && Date.now() - new Date(wifi.updatedAt).getTime() > offerTtlMs) {
    await save(phone, state, undefined);
    state = { ...state, wifi: undefined };
    wifi = undefined;
  }

  // Not in the middle of a request: only the advert, the word "جاهز" and the status question matter.
  if (!wifi || wifi.step === "offered") {
    if (mentionsWifi(text) && words.includes("حاله")) {
      return statusReply(phone, state);
    }

    const offered = wifi?.step === "offered";
    const wantsToApply =
      (offered && isReady(text, words)) ||
      (mentionsWifi(text) && isReady(text, words)) ||
      (mentionsWifi(text) && applyWords.some((word) => words.includes(word)));

    if (wantsToApply) {
      await save(phone, state, { step: "region", updatedAt: new Date().toISOString() });

      return reply(
        [
          "أهلًا بك 👋",
          "سنسجّل طلب الويفي الخاص بك خطوة بخطوة.",
          "(للإلغاء في أي وقت اكتب: *إلغاء*)",
          "",
          questionFor("region")
        ].join("\n")
      );
    }

    // The advert is about to be sent by the campaign: remember it, and let the campaign answer.
    if (mentionsWifi(text)) {
      const stale = !wifi || Date.now() - new Date(wifi.updatedAt).getTime() > 60 * 60 * 1000;

      if (stale) {
        await save(phone, state, { step: "offered", updatedAt: new Date().toISOString() });
      }
    }

    return null;
  }

  if (cancelWords.some((word) => words.includes(word))) {
    await discardImages(wifi);
    await save(phone, state, { step: "offered", updatedAt: new Date().toISOString() });

    return reply("تم إلغاء الطلب. وإذا أردت التقديم من جديد اكتب: *جاهز*");
  }

  // The summary: confirm, or choose something to correct.
  if (wifi.step === "confirm") {
    if (yesTexts.includes(text)) {
      const sent = await submitRequest(phone, wifi);

      if (!sent.ok) {
        return reply("تعذّر إرسال طلبك الآن 🙏\nمعلوماتك محفوظة، وللمحاولة من جديد اكتب: *1*");
      }

      await copyToAdmins(phone, wifi, sent.number);
      await discardImages(wifi);
      await save(phone, state, undefined);

      const lines = ["✅ *تم استلام طلبك*", ""];

      if (sent.number) {
        lines.push(`رقم طلبك: *#${sent.number}*`);
      }

      lines.push("", "لمتابعة طلبكم تواصلوا معنا واتساب 👇", contactLink);

      return reply(lines.join("\n"));
    }

    if (editTexts.includes(text)) {
      await save(phone, state, { ...wifi, step: "pick_edit" });

      return reply(editMenu());
    }

    return reply(`اكتب *1* للتأكيد أو *2* للتعديل.\n\n${summary(wifi)}`);
  }

  if (wifi.step === "pick_edit") {
    if (text === "رجوع") {
      await save(phone, state, { ...wifi, step: "confirm" });

      return reply(summary(wifi));
    }

    const chosen = FIELDS[Number(onlyDigits(text)) - 1];

    if (!chosen || text !== String(Number(onlyDigits(text)))) {
      return reply(`لم أفهم اختيارك.\n\n${editMenu()}`);
    }

    await save(phone, state, { ...wifi, step: chosen.key, editing: true });

    return reply(chosen.question);
  }

  // A question being answered.
  const field = wifi.step;

  if (field === "id_card" || field === "mauritel") {
    const media = message.media[0];

    if (!media || !isImage(media.contentType)) {
      return reply(`أحتاج *صورة*. ${questionFor(field)}`);
    }

    const stored = await stashImage(media, phone, field === "id_card" ? "id" : "mauritel");

    if (!stored) {
      return reply("تعذّر حفظ الصورة. أعد إرسالها من فضلك.");
    }

    const previous = field === "id_card" ? wifi.idCard : wifi.mauritel;

    if (previous) {
      await deletePropertyMedia(previous.path);
    }

    const updated: WifiState = field === "id_card" ? { ...wifi, idCard: stored } : { ...wifi, mauritel: stored };
    const next = advance(updated, field);

    await save(phone, state, next.wifi);

    return reply(next.text);
  }

  if (message.media.length > 0) {
    return reply(`اكتب المعلومة *نصًا* من فضلك.\n\n${questionFor(field)}`);
  }

  const answer = readTextAnswer(field, message.body);

  if ("error" in answer) {
    return reply(answer.error);
  }

  const next = advance(withValue(wifi, field, answer.value), field);

  await save(phone, state, next.wifi);

  return reply(next.text);
}
