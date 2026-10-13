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
// "quick": a team member is sending the whole request as a few messages (see the quick add below).
export type WifiStep = WifiField | "confirm" | "pick_edit" | "offered" | "quick";

export type WifiState = {
  step: WifiStep;
  updatedAt: string;
  /** Set while one answer is being corrected from the summary, so the flow returns to it. */
  editing?: boolean;
  /** Sent as one filled-in form and the pictures, not answered question by question. */
  quick?: boolean;
  /** The form was started by a team member (the customer's own number is then not theirs). */
  team?: boolean;
  /** The first phone was taken from the WhatsApp number, so it is not asked. */
  phone1Auto?: boolean;
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
    label: "رقم هاتف آخر",
    question: "اكتب *رقم هاتف آخر* غير رقم الواتساب (8 أرقام). وإذا لا يوجد اكتب: *لا يوجد*."
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
    "اكتب *2* لتعديل معلومة",
    ...(wifi.quick ? ["اكتب *3* لتبديل الصورتين (البطاقة ↔ داية موريتل)"] : [])
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
  const following = FIELDS.slice(index + 1);
  const next = following.find((item) => !(item.key === "phone1" && wifi.phone1Auto));

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
  // A team member's own number says nothing about the customer: the customer's first phone is used.
  form.append("whatsapp_number", wifi.team && wifi.phone1 ? `222${wifi.phone1}` : onlyDigits(phone));
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
      `واتساب العميل: +${onlyDigits(phone)}`
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

/**
 * Quick add, for the team numbers (WIFI_LOOKUP_NUMBERS).
 *
 * A team member writes "طلب جديد" followed by the details -- labelled lines or just the values in the
 * order of the dashboard summary -- and then sends the two pictures, as many messages as they like and
 * in any order. WhatsApp sends an album as separate messages that can be handled at the same moment,
 * so a picture is never written into the conversation state: each one is its own file in the bucket,
 * and the files found there are what counts. Once the details and both pictures are in, the usual
 * summary is shown and "1" sends the request to the dashboard.
 */
type QuickKey = "name" | "national_id" | "phones" | "phone1" | "phone2" | "codes" | "code1" | "code2" | "region";

const quickStartWords = ["طلب جديد", "طلب جديده", "اضافه طلب", "رفع طلب", "تسجيل طلب"];

const QUICK_LABELS = new Map<string, QuickKey>(
  (
    [
      ["الاسم", "name"],
      ["اسم", "name"],
      ["اسم العميل", "name"],
      ["الاسم الكامل", "name"],
      ["name", "name"],
      ["الرقم الوطني", "national_id"],
      ["رقم وطني", "national_id"],
      ["الوطني", "national_id"],
      ["رقم الهويه", "national_id"],
      ["الهويه", "national_id"],
      ["nni", "national_id"],
      ["الهاتف", "phones"],
      ["هاتف", "phones"],
      ["الهواتف", "phones"],
      ["الجوال", "phones"],
      ["جوال", "phones"],
      ["رقم الهاتف", "phones"],
      ["التلفون", "phones"],
      ["تلفون", "phones"],
      ["الارقام", "phones"],
      ["phone", "phones"],
      ["tel", "phones"],
      ["الهاتف الاول", "phone1"],
      ["هاتف 1", "phone1"],
      ["الهاتف 1", "phone1"],
      ["الهاتف الثاني", "phone2"],
      ["رقم هاتف اخر", "phone2"],
      ["رقم اخر", "phone2"],
      ["هاتف اخر", "phone2"],
      ["الهاتف الاخر", "phone2"],
      ["رقم هاتف ثاني", "phone2"],
      ["هاتف 2", "phone2"],
      ["الهاتف 2", "phone2"],
      ["الكود", "codes"],
      ["كود", "codes"],
      ["الاكواد", "codes"],
      ["الكودات", "codes"],
      ["code", "codes"],
      ["codes", "codes"],
      ["الكود العلوي", "code1"],
      ["كود علوي", "code1"],
      ["الكود الاعلى", "code1"],
      ["الكود الاول", "code1"],
      ["كود 1", "code1"],
      ["الكود 1", "code1"],
      ["الكود السفلي", "code2"],
      ["كود سفلي", "code2"],
      ["الكود الاسفل", "code2"],
      ["الكود الثاني", "code2"],
      ["كود 2", "code2"],
      ["الكود 2", "code2"],
      ["المنطقه", "region"],
      ["منطقه", "region"],
      ["الحي", "region"],
      ["حي", "region"],
      ["region", "region"]
    ] as Array<[string, QuickKey]>
  ).map(([word, key]) => [normalizeCampaignText(word), key])
);

const QUICK_LABEL_LINE = /^\s*([^:：=\n]{1,30}?)\s*[:：=]\s*(.*)$/;

function readQuickStart(body: string) {
  const first = body.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const text = normalizeCampaignText(latinDigits(first));

  return quickStartWords.some((word) => text === word || text.startsWith(`${word} `));
}

/** One or two phone numbers in a line: "22334455 - 33445566", "22334455 33445566", "+222 22334455". */
function readPhones(value: string) {
  const text = latinDigits(value);
  const parts = text.split(/\s*(?:[-–—،,/]|\sو\s)\s*/).map(readPhone);

  if (parts.length > 0 && parts.every(Boolean)) {
    return parts as string[];
  }

  return text
    .split(/\s+/)
    .map(readPhone)
    .filter((phone): phone is string => Boolean(phone));
}

function isPhoneLine(line: string) {
  return /^[\d\s\-–—،,/+و]+$/.test(latinDigits(line).trim()) && readPhones(line).length > 0;
}

/** The two device codes in a line: "AB12 - CD34" or "AB12 CD34". */
function readCodes(value: string) {
  const text = latinDigits(value).trim();
  const marked = text.split(/\s*[-–—،,/]\s*/).map((part) => part.trim()).filter(Boolean);
  const parts = marked.length >= 2 ? marked : text.split(/\s+/).filter(Boolean);

  return parts.slice(0, 2);
}

function quickSet(wifi: WifiState, key: QuickKey, raw: string): WifiState {
  const value = raw.trim();

  if (!value) {
    return wifi;
  }

  const simple = (field: WifiField) => {
    const answer = readTextAnswer(field, value);

    return "value" in answer ? withValue(wifi, field, answer.value) : wifi;
  };

  switch (key) {
    case "name":
      return simple("name");
    case "national_id":
      return simple("national_id");
    case "region":
      return simple("region");
    case "phone1":
      return simple("phone1");
    case "phone2":
      return simple("phone2");
    case "code1":
      return simple("code1");
    case "code2":
      return simple("code2");
    case "phones": {
      const phones = readPhones(value);

      if (phones.length === 0) {
        return wifi;
      }

      // The WhatsApp number is already the first phone, so a number written here is the other one.
      if (wifi.phone1Auto) {
        const other = phones.find((number) => number !== wifi.phone1);

        return other ? { ...wifi, phone2: other } : wifi;
      }

      return { ...wifi, phone1: phones[0], phone2: phones[1] ?? wifi.phone2 };
    }
    case "codes": {
      const codes = readCodes(value).filter((code) => code.length >= 2 && code.length <= 30);

      if (codes.length === 0) {
        return wifi;
      }

      return { ...wifi, code1: codes[0], code2: codes[1] ?? wifi.code2 };
    }
  }
}

/** A line with no label: placed by what it looks like, in the order of the dashboard summary. */
function quickGuess(wifi: WifiState, line: string, allowText: boolean): WifiState {
  const trimmed = latinDigits(line).trim();
  const isId = /^\d{9,13}$/.test(trimmed) && !/^(00)?222\d{8}$/.test(trimmed);

  if (isId && !wifi.nationalId) {
    return quickSet(wifi, "national_id", line);
  }

  if (isPhoneLine(line)) {
    if (!wifi.phone1 || (wifi.phone1Auto && wifi.phone2 === undefined)) {
      return quickSet(wifi, "phones", line);
    }

    if (!wifi.phone1Auto && wifi.phone2 === undefined && !wifi.code1 && readPhones(line).length === 1) {
      return quickSet(wifi, "phone2", line);
    }

    return !wifi.code1 ? quickSet(wifi, "codes", line) : wifi;
  }

  // "لا يوجد" as the other phone.
  if (wifi.phone2 === undefined && noSecondPhone.includes(normalizeCampaignText(trimmed))) {
    return quickSet(wifi, "phone2", line);
  }

  if (!/\d/.test(trimmed)) {
    // A customer's chatter ("السلام عليكم") must not become the name: plain text lines are only
    // placed when the message also carries labelled lines, or comes from the team.
    if (!allowText) {
      return wifi;
    }

    return !wifi.name ? quickSet(wifi, "name", line) : !wifi.region ? quickSet(wifi, "region", line) : wifi;
  }

  return !wifi.code1 ? quickSet(wifi, "codes", line) : !wifi.region ? quickSet(wifi, "region", line) : wifi;
}

function applyQuickText(wifi: WifiState, body: string): WifiState {
  let next = wifi;
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const hasLabels = lines.some((line) => {
    const labelled = line.match(QUICK_LABEL_LINE);

    return Boolean(labelled && QUICK_LABELS.has(normalizeCampaignText(latinDigits(labelled[1]))));
  });
  const allowText = Boolean(wifi.team) || hasLabels;

  for (const [index, line] of lines.entries()) {
    if (index === 0 && readQuickStart(line)) {
      continue;
    }

    const labelled = line.match(QUICK_LABEL_LINE);

    if (labelled) {
      const key = QUICK_LABELS.get(normalizeCampaignText(latinDigits(labelled[1])));

      // A label that is not one of ours ("ملاحظة: ...") is left alone rather than guessed at.
      if (key) {
        next = quickSet(next, key, labelled[2]);
      }

      continue;
    }

    next = quickGuess(next, line, allowText);
  }

  return next;
}

/** A short caption naming the picture ("بطاقة", "داية موريتل"). Anything longer is the details. */
function quickHint(body: string): "id" | "mau" | null {
  const text = normalizeCampaignText(latinDigits(body));

  if (!text || /[\n:：]/.test(body) || text.length > 25) {
    return null;
  }

  if (/(بطاقه|هويه|وطني)/.test(text)) {
    return "id";
  }

  if (/(دايه|موريتل|مودم|mauritel)/.test(text)) {
    return "mau";
  }

  return null;
}

type QuickFile = { path: string; contentType: string; hint: "id" | "mau" | "img"; at: number };

const quickFilePattern = /^(\d+)-q(id|mau|img)[a-z0-9]{4}\.(\w+)$/;

function contentTypeForExtension(extension: string) {
  switch (extension.toLowerCase()) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}

async function listQuickImages(phone: string): Promise<QuickFile[]> {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return [];
  }

  const folder = `wifi/${onlyDigits(phone)}`;
  const { data, error } = await supabase.storage.from(propertyMediaBucket).list(folder, { limit: 100 });

  if (error || !data) {
    console.error("Wifi quick add: could not list the pictures", error);
    return [];
  }

  const files: QuickFile[] = [];

  for (const entry of data as Array<{ name: string }>) {
    const match = entry.name.match(quickFilePattern);

    if (match) {
      files.push({
        path: `${folder}/${entry.name}`,
        contentType: contentTypeForExtension(match[3]),
        hint: match[2] as QuickFile["hint"],
        at: Number(match[1])
      });
    }
  }

  return files.sort((first, second) => first.at - second.at);
}

/** Removes every picture a quick add has left for this number. */
async function discardQuick(phone: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return;
  }

  for (const file of await listQuickImages(phone)) {
    await deletePropertyMedia(file.path);
  }
}

function quickMissing(wifi: WifiState, pictures: number) {
  const missing: string[] = [];
  // A customer is asked for another number; a team member may leave it out.
  const keys: WifiField[] = ["region", "name", "national_id", "phone1", ...(wifi.team ? [] : (["phone2"] as WifiField[])), "code1", "code2"];

  for (const key of keys) {
    if (!valueOf(wifi, key)) {
      missing.push(FIELDS.find((field) => field.key === key)?.label ?? key);
    }
  }

  if (pictures === 0) {
    missing.push("صورة البطاقة", "صورة داية موريتل");
  } else if (pictures === 1) {
    missing.push("صورة ثانية (البطاقة أو داية موريتل)");
  }

  return missing;
}

/** Which of the pictures is the ID card and which the Mauritel device: by caption, then by order. */
function assignQuickPictures(files: QuickFile[]) {
  const pool = [...files];
  const take = (wanted: (file: QuickFile) => boolean) => {
    const index = pool.findIndex(wanted);

    return index >= 0 ? pool.splice(index, 1)[0] : undefined;
  };

  let idFile = take((file) => file.hint === "id") ?? take((file) => file.hint === "img");
  let mauFile = take((file) => file.hint === "mau") ?? take((file) => file.hint === "img");

  idFile = idFile ?? take(() => true);
  mauFile = mauFile ?? take(() => true);

  return { idFile, mauFile };
}

/** The first message a customer gets after "جاهز", and the form they copy as the second. */
function formIntro() {
  return [
    "أهلًا بك 👋",
    "سنسجّل طلب الويفي الخاص بك.",
    "",
    "1️⃣ انسخ *النموذج* الذي في الرسالة التالية، عبّئه وأرسله *في رسالة واحدة*.",
    "2️⃣ ثم أرسل *صورتين*: بطاقة التعريف، وصورة داية موريتل."
  ].join("\n");
}

function formTemplate(autoPhone: boolean) {
  return [
    "المنطقة:",
    "الاسم:",
    "الرقم الوطني:",
    ...(autoPhone ? [] : ["الهاتف الأول:"]),
    "رقم هاتف آخر:",
    "الكود العلوي:",
    "الكود السفلي:"
  ].join("\n");
}

const quickExample = [
  "المنطقة: ",
  "الاسم: ",
  "الرقم الوطني: ",
  "الهاتف: 22334455 - 33445566",
  "الكود: AAAA - BBBB"
].join("\n");

async function quickMessage(
  message: IncomingWhatsAppMessage,
  state: ConversationState,
  wifi: WifiState,
  starting: boolean
): Promise<ConversationResult> {
  const phone = message.from;
  const hint = message.media.length > 0 ? quickHint(message.body) : null;
  let received = 0;

  for (const media of message.media) {
    if (!isImage(media.contentType)) {
      continue;
    }

    const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
    const stored = await stashImage(media, phone, `q${hint ?? "img"}${suffix}`);

    if (!stored) {
      return reply("تعذّر حفظ الصورة. أعد إرسالها من فضلك.");
    }

    received += 1;
  }

  // A caption that only names the picture is not details. Everything else is read for them.
  const next = hint ? wifi : applyQuickText(wifi, message.body);
  const changed = starting || JSON.stringify(next) !== JSON.stringify(wifi);
  const files = await listQuickImages(phone);

  if (starting && received === 0 && next === wifi) {
    await save(phone, state, wifi);

    return reply(
      [
        "📥 *طلب جديد*",
        "",
        "أرسل المعلومات في رسالة واحدة، مثل:",
        "",
        quickExample,
        "",
        "ثم أرسل *الصورتين*: بطاقة التعريف وصورة داية موريتل.",
        "(للإلغاء: *إلغاء*)"
      ].join("\n")
    );
  }

  // A customer whose message held nothing recognisable is asked question by question instead.
  if (!wifi.team && !starting && received === 0 && next === wifi && message.body.trim()) {
    await discardQuick(phone);

    const first = FIELDS.find(
      (field) =>
        field.key !== "id_card" &&
        field.key !== "mauritel" &&
        !(field.key === "phone1" && wifi.phone1Auto) &&
        valueOf(wifi, field.key) === undefined
    );

    if (first) {
      await save(phone, state, { ...wifi, step: first.key, quick: undefined });

      return reply(`لم أفهم الرسالة، سأسألك سؤالًا سؤالًا 👇\n\n${first.question}`);
    }
  }

  const missing = quickMissing(next, files.length);

  if (missing.length > 0) {
    // Only written when the details changed: a picture alone must not put an older copy of the
    // conversation back over a message being handled at the same moment.
    if (changed) {
      await save(phone, state, next);
    }

    return reply(["⏳ *الناقص:*", missing.join("، "), "", "(للإلغاء: *إلغاء*)"].join("\n"));
  }

  const { idFile, mauFile } = assignQuickPictures(files);

  if (!idFile || !mauFile) {
    return reply("⏳ *الناقص:* صورة ثانية");
  }

  const ready: WifiState = {
    ...next,
    phone2: next.phone2 ?? "",
    team: wifi.team,
    idCard: { path: idFile.path, contentType: idFile.contentType },
    mauritel: { path: mauFile.path, contentType: mauFile.contentType },
    step: "confirm",
    quick: true
  };

  await save(phone, state, ready);

  return reply(summary(ready));
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

    if (wifi.quick) {
      await discardQuick(phone);
    }

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

  // A team member starting a request in one go ("طلب جديد"). Starting again drops the unfinished one.
  if (canLookUp(phone) && readQuickStart(message.body)) {
    if (wifi) {
      await discardImages(wifi);
    }

    await discardQuick(phone);

    const fresh: WifiState = { step: "quick", quick: true, team: true, updatedAt: new Date().toISOString() };

    return quickMessage(message, { ...state, wifi: undefined }, fresh, true);
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
      // The first phone is the WhatsApp number the customer is writing from.
      const auto = readPhone(phone);

      await discardQuick(phone);
      await save(phone, state, {
        step: "quick",
        quick: true,
        updatedAt: new Date().toISOString(),
        ...(auto ? { phone1: auto, phone1Auto: true } : {})
      });

      return { debugIntent: "intro", reply: formIntro(), followUps: [formTemplate(Boolean(auto))] };
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

    if (wifi.quick) {
      await discardQuick(phone);
    }

    if (wifi.team) {
      await save(phone, state, undefined);

      return reply("تم إلغاء الطلب.");
    }

    await save(phone, state, { step: "offered", updatedAt: new Date().toISOString() });

    return reply("تم إلغاء الطلب. وإذا أردت التقديم من جديد اكتب: *جاهز*");
  }

  // Details and pictures still arriving.
  if (wifi.step === "quick") {
    return quickMessage(message, state, wifi, false);
  }

  // The summary: confirm, or choose something to correct.
  if (wifi.step === "confirm") {
    if (yesTexts.includes(text)) {
      const sent = await submitRequest(phone, wifi);

      if (!sent.ok) {
        return reply("تعذّر إرسال طلبك الآن 🙏\nمعلوماتك محفوظة، وللمحاولة من جديد اكتب: *1*");
      }

      if (wifi.quick) {
        await discardQuick(phone);
      }

      if (wifi.team) {
        await discardImages(wifi);
        await save(phone, state, undefined);

        return reply(
          [
            "✅ *تم رفع الطلب إلى الداشبورد*",
            sent.number ? `رقم الطلب: *#${sent.number}*` : "",
            wifi.name ?? ""
          ]
            .filter(Boolean)
            .join("\n")
        );
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

    if (wifi.quick && text === "3" && wifi.idCard && wifi.mauritel) {
      const swapped: WifiState = { ...wifi, idCard: wifi.mauritel, mauritel: wifi.idCard };

      await save(phone, state, swapped);

      return reply(`تم تبديل الصورتين ✅\n\n${summary(swapped)}`);
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
