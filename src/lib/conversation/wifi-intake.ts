import type { IncomingWhatsAppMessage } from "@/lib/whatsapp/types";
import { getServiceSupabase } from "@/lib/supabase/server";
import { normalizeCampaignText } from "@/lib/campaigns";
import { deletePropertyMedia, propertyMediaBucket } from "@/lib/whatsapp/media";
import { setConversationState } from "./store";
import type { ConversationResult, ConversationState } from "./types";

/**
 * Wifi requests taken over WhatsApp.
 *
 * A customer who has seen the "ويفي" campaign writes "تقديم ويفي" and is walked through six steps:
 * name, beneficiary number, district, area, a photo of the ID card and a photo of the Mauritel
 * receipt. The finished request is posted to the Wifi dashboard (/api/intake) and lands in the same
 * table the team works from, tagged as coming from WhatsApp.
 *
 * Off unless WIFI_INTAKE_URL and WIFI_INTAKE_KEY are both set, so shipping this file changes nothing
 * for a deployment that has not been wired to the dashboard yet.
 */

type StoredImage = { path: string; contentType: string };

export type WifiState = {
  step: "name" | "beneficiary" | "moughataa" | "region" | "id_card" | "mauritel";
  startedAt: string;
  name?: string;
  beneficiary?: string;
  moughataa?: string;
  region?: string;
  idCard?: StoredImage;
  mauritel?: StoredImage;
};

// Must match the list in the dashboard exactly: the dashboard refuses any other spelling.
const MOUGHATAAS = [
  "تفرغ زينة",
  "لكصر",
  "السبخة",
  "تيارت",
  "دار النعيم",
  "توجنين",
  "عرفات",
  "الميناء",
  "الرياض"
];

const STATUS_LABELS: Record<string, string> = {
  new: "جديد",
  review: "قيد المراجعة",
  in_progress: "قيد التنفيذ",
  done: "مكتمل",
  rejected: "مرفوض"
};

// Words that, next to "wifi", mean the person wants to apply. Written the way normalizeCampaignText
// leaves them: no hamza, ة read as ه.
const applyWords = ["تقديم", "تقدم", "قدم", "اقدم", "تسجيل", "سجل", "طلب", "اشتراك"];
const cancelWords = ["الغاء", "الغي", "خروج", "توقف"];
const retryWords = ["اعاده", "حاول", "ارسال"];

const flowTtlMs = 2 * 60 * 60 * 1000;

function mentionsWifi(text: string) {
  return /(ويفي|وايفي|وايفاي|واي فاي|wifi|wi fi)/.test(text);
}

function digits(value: string) {
  return value.replace(/\D/g, "");
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

function moughataaMenu() {
  return MOUGHATAAS.map((name, index) => `${index + 1}. ${name}`).join("\n");
}

function readMoughataa(body: string) {
  const text = normalizeCampaignText(body);
  const number = Number(digits(text));

  if (number >= 1 && number <= MOUGHATAAS.length && text === String(number)) {
    return MOUGHATAAS[number - 1];
  }

  return MOUGHATAAS.find((name) => normalizeCampaignText(name) === text);
}

function extensionFor(contentType: string) {
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
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

/** Holds one picture in the private bucket until the whole request is ready to send. */
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
  const path = `wifi/${digits(phone)}/${Date.now()}-${label}.${extensionFor(contentType)}`;

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

function isImage(contentType: string) {
  return contentType.startsWith("image/") || contentType === "application/pdf";
}

/** Sends the finished request to the dashboard. */
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
  form.append("beneficiary_number", wifi.beneficiary ?? "");
  form.append("whatsapp_number", digits(phone));
  form.append("moughataa", wifi.moughataa ?? "");
  form.append("region", wifi.region ?? "");
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

async function statusReply(phone: string) {
  try {
    const response = await fetch(`${intakeUrl()}?phone=${digits(phone)}`, {
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
      return reply("لا توجد طلبات ويفي مسجّلة على هذا الرقم.\n\nللتقديم اكتب: *تقديم ويفي*");
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

async function save(phone: string, state: ConversationState, wifi: WifiState | undefined) {
  await setConversationState(phone, { ...state, wifi });
}

/**
 * Handles one incoming message for the wifi flow.
 *
 * Returns null when the message has nothing to do with it, so everything else in the bot runs
 * exactly as before.
 */
export async function handleWifiIntake(
  message: IncomingWhatsAppMessage,
  state: ConversationState
): Promise<ConversationResult | null> {
  if (!isConfigured()) {
    return null;
  }

  const phone = message.from;
  const text = normalizeCampaignText(message.body);
  const words = text.split(" ").filter(Boolean);
  const wifi = state.wifi;

  // A flow left open for hours is dropped, and the message is read as if it had never existed.
  if (wifi && Date.now() - new Date(wifi.startedAt).getTime() > flowTtlMs) {
    await discardImages(wifi);
    await save(phone, state, undefined);

    return handleWifiIntake(message, { ...state, wifi: undefined });
  }

  if (!wifi) {
    if (mentionsWifi(text) && words.includes("حاله")) {
      return statusReply(phone);
    }

    if (mentionsWifi(text) && applyWords.some((word) => words.includes(word))) {
      await save(phone, state, { step: "name", startedAt: new Date().toISOString() });

      return reply(
        [
          "أهلًا بك 👋",
          "سنسجّل طلب الويفي الخاص بك خطوة بخطوة.",
          "(للإلغاء في أي وقت اكتب: *إلغاء*)",
          "",
          "أولًا: اكتب *اسمك الكامل*."
        ].join("\n")
      );
    }

    return null;
  }

  if (cancelWords.some((word) => words.includes(word))) {
    await discardImages(wifi);
    await save(phone, state, undefined);

    return reply("تم إلغاء الطلب. وإذا أردت التقديم من جديد اكتب: *تقديم ويفي*");
  }

  switch (wifi.step) {
    case "name": {
      const name = message.body.trim();

      if (name.length < 3 || message.media.length > 0) {
        return reply("اكتب *اسمك الكامل* من فضلك (3 أحرف على الأقل).");
      }

      await save(phone, state, { ...wifi, name, step: "beneficiary" });

      return reply(`تشرفنا يا ${name.split(" ")[0]} 🌟\n\nاكتب الآن *رقم المستفيد*.`);
    }

    case "beneficiary": {
      const beneficiary = message.body.trim();

      if (beneficiary.length < 3 || message.media.length > 0) {
        return reply("اكتب *رقم المستفيد* كما هو مكتوب عندك.");
      }

      await save(phone, state, { ...wifi, beneficiary, step: "moughataa" });

      return reply(`اختر *المقاطعة* بكتابة رقمها:\n\n${moughataaMenu()}`);
    }

    case "moughataa": {
      const moughataa = readMoughataa(message.body);

      if (!moughataa) {
        return reply(`لم أفهم اختيارك. اكتب *رقم* المقاطعة فقط:\n\n${moughataaMenu()}`);
      }

      await save(phone, state, { ...wifi, moughataa, step: "region" });

      return reply("اكتب *المنطقة أو الحي* الذي تسكن فيه.");
    }

    case "region": {
      const region = message.body.trim();

      if (region.length < 2 || message.media.length > 0) {
        return reply("اكتب *اسم المنطقة أو الحي*.");
      }

      await save(phone, state, { ...wifi, region, step: "id_card" });

      return reply("أرسل الآن *صورة بطاقة التعريف* (صورة واضحة).");
    }

    case "id_card": {
      const media = message.media[0];

      if (!media || !isImage(media.contentType)) {
        return reply("أحتاج *صورة* بطاقة التعريف. أرسلها كصورة من فضلك.");
      }

      const idCard = await stashImage(media, phone, "id");

      if (!idCard) {
        return reply("تعذّر حفظ الصورة. أعد إرسالها من فضلك.");
      }

      await save(phone, state, { ...wifi, idCard, step: "mauritel" });

      return reply("ممتاز ✅\n\nأرسل الآن *صورة من داية موريتل*.");
    }

    case "mauritel": {
      const media = message.media[0];
      let current = wifi;

      if (media) {
        if (!isImage(media.contentType)) {
          return reply("أحتاج *صورة* من داية موريتل. أرسلها كصورة من فضلك.");
        }

        const mauritel = await stashImage(media, phone, "mauritel");

        if (!mauritel) {
          return reply("تعذّر حفظ الصورة. أعد إرسالها من فضلك.");
        }

        current = { ...wifi, mauritel };
        await save(phone, state, current);
      } else if (!(current.mauritel && retryWords.some((word) => words.includes(word)))) {
        return reply(
          current.mauritel
            ? "صورتك محفوظة. لإعادة محاولة إرسال الطلب اكتب: *إعادة*"
            : "أحتاج *صورة* من داية موريتل. أرسلها كصورة من فضلك."
        );
      }

      const sent = await submitRequest(phone, current);

      if (!sent.ok) {
        return reply("تعذّر إرسال طلبك الآن 🙏\nصورك محفوظة، وللمحاولة من جديد اكتب: *إعادة*");
      }

      await discardImages(current);
      await save(phone, state, undefined);

      const lines = ["✅ *تم استلام طلبك*", ""];

      if (sent.number) {
        lines.push(`رقم طلبك: *#${sent.number}*`);
      }

      lines.push("سنراجعه ونتواصل معك قريبًا.", "", "لمعرفة حالة طلبك في أي وقت اكتب: *حالة ويفي*");

      return reply(lines.join("\n"));
    }
  }
}
