import type { IncomingWhatsAppMessage } from "@/lib/whatsapp/types";
import { getServiceSupabase } from "@/lib/supabase/server";
import { extractMessage } from "./extract";
import { aiExtractMessage } from "./ai-extract";
import { getRuntimeDictionary, includesAny } from "./local-dictionary";
import { mockProperties } from "./mock-data";
import { getConversationState, setConversationState } from "./store";
import { storePropertyMedia, storePropertyVideo } from "@/lib/whatsapp/media";
import { getSettings } from "@/lib/settings";
import { notifyAdmins } from "@/lib/notify-admins";
import { handleAdminCommand } from "./admin-commands";
import { sendNotification } from "@/lib/notifications";
import { getMessage } from "@/lib/bot-messages";
import { findReferralCode } from "./referral-code";
import { isGreetingOnly, salutationFor } from "./greeting";
import { looksLikeArea, nextCollectQuestion, readPrice, readSide, readSpecs, type CollectState } from "./collect";
import { saveCollectionEntry } from "@/lib/collection-entries";
import { demoListingFrom, demoMark, hasDemoExpired, isDemoEntry, isDemoExit, markDemo, type DemoState } from "./demo";
import { commissionNote } from "@/lib/commission";
import { getHandover, markAcknowledged, needsAcknowledgement } from "@/lib/handover";
import { getActiveCampaigns, matchCampaign, recordCampaignHit } from "@/lib/campaigns";
import { handleWifiIntake } from "./wifi-intake";
import type { MediaKind } from "@/lib/media-kinds";
import { parseRoomsAnswer } from "@/lib/rooms-answer";
import { deletePropertyMedia, signPropertyMedia } from "@/lib/whatsapp/media";
import type { ConversationResult, ConversationState, DraftProperty, ExtractedMessage, PropertyCandidate } from "./types";

const requiredPropertyFields = ["السعر", "المنطقة", "معلم مشهور قريب", "عدد الغرف", "فيديو للعقار"];
const knownAreas = ["تفرغ زينة", "عرفات", "لكصر", "تيارت", "دار النعيم", "السبخة", "الميناء"];
const selectionTtlMs = 15 * 60 * 1000;
const draftTtlMs = 60 * 60 * 1000;

function isYes(body: string) {
  return /^(نعم|اي|إي|أجل|تمام|صح|موافق|اكد|أكد)$/i.test(body.trim());
}

function isNo(body: string) {
  return /^(لا|لأ|كلا|تعديل|الغاء|إلغاء)$/i.test(body.trim());
}

function isCasualReply(body: string) {
  return /^(تمام|اوكي|أوكي|ok|okay|شكرا|شكرًا|مشكور|يعطيك العافية|زين|حسنًا)$/i.test(body.trim());
}

function normalizeDictionaryText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/[ة]/g, "ه")
    .replace(/[ى]/g, "ي")
    .replace(/[ـًٌٍَُِّْ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ");
}

function editDistance(first: string, second: string) {
  const distances = Array.from({ length: first.length + 1 }, (_, index) => index);

  for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
    let previous = distances[0];
    distances[0] = secondIndex;

    for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
      const current = distances[firstIndex];
      distances[firstIndex] =
        first[firstIndex - 1] === second[secondIndex - 1]
          ? previous
          : Math.min(previous, distances[firstIndex], distances[firstIndex - 1]) + 1;
      previous = current;
    }
  }

  return distances[first.length];
}

function findAreaCandidate(body: string, areas: string[]) {
  const normalizedBody = normalizeDictionaryText(body);
  const compactBody = normalizedBody.replace(/\s/g, "");

  const matches = areas
    .map((area) => {
      const normalizedArea = normalizeDictionaryText(area);
      const compactArea = normalizedArea.replace(/\s/g, "");
      const directMatch = normalizedBody.includes(normalizedArea) || compactBody.includes(compactArea);
      const prefixMatch =
        compactBody.length >= 4 && (compactArea.startsWith(compactBody) || compactBody.startsWith(compactArea));
      const distance = editDistance(compactBody, compactArea);
      const distanceMatch = compactBody.length >= 4 && distance <= (compactArea.length <= 6 ? 1 : 2);

      return {
        area,
        score: directMatch ? 3 : prefixMatch ? 2 : distanceMatch ? 1 : 0,
        distance
      };
    })
    .filter((item) => item.score > 0)
    .sort((first, second) => second.score - first.score || first.distance - second.distance);

  return matches[0]?.area;
}

function findCustomDictionaryReply(body: string, dictionary: Awaited<ReturnType<typeof getRuntimeDictionary>>) {
  const normalizedBody = normalizeDictionaryText(body);
  const matches = dictionary.customResponses
    .map((item) => ({
      ...item,
      normalizedPhrase: normalizeDictionaryText(item.phrase)
    }))
    .filter((item) => item.normalizedPhrase && (normalizedBody === item.normalizedPhrase || normalizedBody.includes(item.normalizedPhrase)))
    .sort((first, second) => second.normalizedPhrase.length - first.normalizedPhrase.length);

  return matches[0];
}

function hasFreshSelection(state: { selectedProperty?: PropertyCandidate; selectedPropertyAt?: string }) {
  if (!state.selectedProperty || !state.selectedPropertyAt) {
    return false;
  }

  return Date.now() - new Date(state.selectedPropertyAt).getTime() <= selectionTtlMs;
}

// Stamped on every change so an abandoned listing draft stops hijacking the conversation.
function touchDraft(draft: DraftProperty): DraftProperty {
  return { ...draft, updatedAt: new Date().toISOString() };
}

export function isDraftFresh(draft: DraftProperty) {
  // Drafts saved before this field existed carry no timestamp, and those are the stuck ones.
  if (!draft.updatedAt) {
    return false;
  }

  const updatedAt = new Date(draft.updatedAt).getTime();

  if (Number.isNaN(updatedAt)) {
    return false;
  }

  return Date.now() - updatedAt <= draftTtlMs;
}

async function formatPropertySummary(draft: DraftProperty) {
  // Shown to the owner as well, though the renter pays it: this is the summary of what the listing
  // will say, and an owner surprised later by a commission they never saw advertised is an argument
  // with a renter standing in front of the house.
  return [
    "راجع ملخص الإعلان قبل إرساله للإدارة:",
    "",
    `النوع: ${draft.type ?? "غير محدد"}`,
    `المقاطعة: ${draft.area}`,
    // Formatted like every other amount: an owner reviewing "70000" beside "30,000 أوقية" has to
    // work out whether the two are even the same kind of number.
    `السعر: ${draft.price ? formatPrice(draft.price) : "غير محدد"}`,
    // The owner's own figure, shown back to them before it goes out: they set it, and this is where
    // a wrong number is still cheap to fix.
    `عمولة المكتب: ${draft.commission ? formatPrice(draft.commission) : "لا توجد"}`,
    `المعلم القريب: ${draft.landmark}`,
    `عدد الغرف: ${draft.rooms ?? "غير محدد"}`,
    ...(draft.extras ? [`إضافات: ${draft.extras}`] : []),
    `الفيديو: ${draft.hasVideo ? "تم استلامه" : "لم يصل بعد"}`,
    "",
    "هل المعلومات صحيحة؟ اكتب نعم لإرسالها للإدارة، أو لا للتعديل أو الإلغاء."
  ].join("\n");
}

function propertyTypePlural(type?: string) {
  if (type === "شقة") {
    return "شقق";
  }

  if (type === "منزل") {
    return "منازل";
  }

  if (type === "غرفة") {
    return "غرف";
  }

  if (type === "محل") {
    return "محلات";
  }

  return "عقارات";
}

function propertyTypeSingular(type?: string) {
  return type ?? "دار";
}

function formatPrice(price: number) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(price)} أوقية`;
}

function formatLandmark(landmark: string) {
  return landmark.replace(/^(قرب|قريبة من|بالقرب من)\s+/i, "").trim();
}

function normalizePhoneDigits(phone: string) {
  return phone.replace(/\D/g, "");
}

// No I, L, O, 0 or 1: the code gets read aloud and retyped, so lookalikes cost more than the few
// characters they add. 31^4 is roughly 900k codes, far more than this will ever need.
const referralAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** True when a code can be told apart from a listing number or a result index typed on its own. */
export function isUsableReferralCode(code: string | null | undefined) {
  return typeof code === "string" && /^[A-Z0-9]{4}$/.test(code) && /[A-Z]/.test(code);
}

/**
 * A four character code with at least one letter.
 *
 * The letter is not decoration. A code arrives on its own, and the only thing separating it from a
 * listing number or a result index -- both plain four digit numbers -- is that it contains a letter.
 * Roughly one code in 226 came out all digits and was rejected on arrival, so the marketer's invites
 * silently registered nobody.
 */
function randomReferralCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = "";

    for (let index = 0; index < 4; index += 1) {
      code += referralAlphabet[Math.floor(Math.random() * referralAlphabet.length)];
    }

    if (isUsableReferralCode(code)) {
      return code;
    }
  }

  // Vanishingly unlikely, but never hand back a code that cannot be recognised.
  return `${referralAlphabet[Math.floor(Math.random() * 23)]}${Math.floor(100 + Math.random() * 900)}`;
}

/**
 * Returns the marketer's code, minting one on first use. The old codes were the phone number
 * itself, which put it inside every invite message the marketer forwarded.
 */
async function getOrCreateReferralCode(phone: string) {
  const supabase = getServiceSupabase();
  const wallet = await ensureWallet(phone);
  const existing = wallet?.referral_code as string | null | undefined;

  // An all-digit code is replaced rather than kept. Nothing is lost by doing so: such a code is
  // rejected on arrival, so the links already carrying it register nobody either way.
  if (existing && isUsableReferralCode(existing)) {
    return existing;
  }

  if (!supabase) {
    return randomReferralCode();
  }

  // The column is unique, so a collision fails the update rather than duplicating a code.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = randomReferralCode();
    const { error } = await supabase
      .from("user_wallets")
      .update({ referral_code: candidate })
      .eq("phone", phone);

    if (!error) {
      return candidate;
    }

    console.error("Referral code collision, retrying", error.message);
  }

  return null;
}

async function makeReferralLink(referralCode: string) {
  // The link must open the bot. It used to fall back to the first admin number, which sent every
  // invited person to a personal WhatsApp instead.
  //
  // The prefilled text greets and then carries the code. A bare code looked like junk in the box:
  // people cleared it and typed their own hello, which loses the referral silently after the
  // marketer had done everything right. findReferralCode reads the code out of the sentence, and
  // still accepts the bare and "ابدأ CODE" forms for links already in circulation.
  const { botWhatsAppNumber } = await getSettings();
  const text = encodeURIComponent(`سلام ${referralCode}`);

  return botWhatsAppNumber
    ? `https://wa.me/${normalizePhoneDigits(botWhatsAppNumber)}?text=${text}`
    : `كود دعوتك: ${referralCode}`;
}


export async function getPointsTopupInstructions(options?: { currentBalance?: number; purposeText?: string }) {
  const settings = await getSettings();
  const paymentNumber = settings.pointsPaymentNumber;
  const currentBalance = options?.currentBalance;

  if (!paymentNumber) {
    return [
      "⚠️ *شحن الأوقية غير مفعل حاليًا*",
      "",
      "الإدارة تحتاج تضيف رقم الدفع في إعدادات النظام حتى نقدر نستقبل طلبات الشحن."
    ].join("\n");
  }

  // Everything goes through the template so the order stays editable. The reason and the balance
  // are variables: prepending them put the balance first and left the template's own sentence in
  // place underneath, so someone publishing a listing was quoted the listing price and then the
  // price of an owner's number. An unknown balance empties its variable and drops its line.
  return getMessage("topup_instructions", {
    paymentNumber: paymentNumber.replace("whatsapp:", ""),
    purpose: options?.purposeText ?? `🔐 عرض رقم المؤجر يحتاج *${settings.contactRevealPoints} أوقية*.`,
    balance: currentBalance,
    revealPoints: settings.contactRevealPoints
  });
}

function formatSearchResults(
  results: PropertyCandidate[],
  extracted: ReturnType<typeof extractMessage>,
  options?: { startIndex?: number; total?: number; hasMore?: boolean }
) {
  const typeText = extracted.propertyType ? propertyTypeSingular(extracted.propertyType) : "دار";
  const searchText = extracted.searchText && extracted.searchText !== "__more__" ? extracted.searchText.trim() : "";
  const placeText = extracted.area ? ` في ${extracted.area}` : searchText ? ` قريبة من ${searchText}` : "";
  const startIndex = options?.startIndex ?? 0;
  const total = options?.total ?? results.length;
  const moreText = options?.hasMore ? "\n\nتريد خيارات أكثر؟ اكتب: 0" : "";

  return [
    `🏠 عندنا ظرك ${total} دار للإيجار${placeText}`,
    "",
    results
    .map((property, index) => {
      return [
        `*${startIndex + index + 1}.* 🏠 دار في ${property.area}`,
        `💰 السعر: *${formatPrice(property.price)}*`,
        ...(property.commission ? [`🏢 عمولة المكتب: *${formatPrice(property.commission)}*`] : []),
        `📍 قريبة من: ${formatLandmark(property.landmark)}`
      ].join("\n");
    })
    .join("\n\n----------------\n\n"),
    "",
    "اكتب رقم الدار التي أعجبتك، مثلا: *1*",
    "بعد الاختيار نرسل لك التفاصيل والفيديو.",
    moreText
  ]
    .filter(Boolean)
    .join("\n");
}

function refineSearchResults(
  results: PropertyCandidate[],
  extracted: ReturnType<typeof extractMessage>
) {
  let refined = [...results];

  if (extracted.maxPrice) {
    refined = refined.filter((property) => property.price <= extracted.maxPrice!);
  }

  if (extracted.rooms) {
    refined = refined.filter((property) => property.rooms === extracted.rooms);
  }

  if (extracted.sortBy === "cheapest") {
    refined.sort((first, second) => first.price - second.price);
  }

  if (extracted.sortBy === "expensive") {
    refined.sort((first, second) => second.price - first.price);
  }

  return refined;
}

export async function submitPropertyForReview(
  ownerPhone: string,
  draft: DraftProperty
) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { saved: false };
  }

  await supabase.from("users").upsert(
    {
      phone: ownerPhone,
      role: "owner"
    },
    {
      onConflict: "phone"
    }
  );

  const { data: property, error } = await supabase
    .from("properties")
    .insert({
      owner_phone: ownerPhone,
      type: draft.type ?? "غير محدد",
      area: draft.area,
      landmark: draft.landmark,
      price: draft.price,
      rooms: draft.rooms,
      office_commission: draft.commission ?? null,
      status: "pending_review",
      // The owner's own words, where a fixed sentence carrying no information used to be.
      description: draft.extras ?? null
    })
    .select("id,property_code")
    .single();

  if (error) {
    console.error("Failed to submit property", error);
    return { saved: false, error: error.message };
  }

  if (draft.videoUrl && property?.id) {
    const { error: mediaError } = await supabase.from("property_media").insert({
      property_id: property.id,
      type: "video",
      storage_url: draft.videoUrl,
      content_type: draft.videoContentType ?? "video/mp4"
    });

    if (mediaError) {
      console.error("Failed to save property video", mediaError);
    }
  }

  // The admin acts on this from WhatsApp, so the message has to carry the reference the commands
  // take, and the commands themselves ready to copy.
  const reference = (property?.property_code as string | null) ?? String(property?.id ?? "").slice(0, 8);

  await notifyAdmins([
    "🏠 *إعلان عقار جديد بانتظار المراجعة*",
    "",
    `🔖 رقم الإعلان: *${reference}*`,
    `📱 المؤجر: ${ownerPhone.replace("whatsapp:", "")}`,
    `🏷 النوع: ${draft.type ?? "غير محدد"}`,
    `📍 المنطقة: ${draft.area ?? "غير محددة"}`,
    `💰 السعر: ${draft.price ?? "غير محدد"}`,
    `🎥 الفيديو: ${draft.hasVideo ? "مرفق" : "غير مرفق"}`,
    "",
    "━━━━━━━━━━━━━━",
    "للتنفيذ من هنا مباشرة:",
    `*قبول ${reference}*`,
    `*رفض ${reference} السبب*`,
    "",
    "🎥 لمشاهدة الفيديو افتح لوحة الإدارة ← العقارات."
  ]);

  return { saved: true, id: property?.id as string | undefined, propertyCode: reference };
}

async function getNextPropertyQuestion(draft: DraftProperty) {
  if (!draft.area) {
    return "في أي مقاطعة يقع العقار؟ مثال: تفرغ زينة، عرفات، لكصر.";
  }

  if (!draft.price) {
    return "كم سعر الإيجار؟ اكتب الرقم مثل 70000، أو بالحروف مثل 70 الف.";
  }

  if (!draft.landmark) {
    return "ما هو أقرب معلم مشهور للعقار؟ مثال: المستشفى الإسباني، كارفور، سوق معروف.";
  }

  if (!draft.rooms) {
    return getMessage("rooms_request");
  }

  if (draft.commission === undefined) {
    return getMessage("commission_request");
  }

  if (!draft.hasVideo) {
    return getMessage("video_request");
  }

  return formatPropertySummary(draft);
}

function mergeDraftFromMessage(
  draft: DraftProperty,
  extracted: ReturnType<typeof extractMessage>,
  body: string,
  activeAreas = knownAreas
) {
  const areaFromText = findAreaCandidate(body, activeAreas);
  const trimmed = body.trim();

  /**
   * A bare number belongs to whichever question is still open.
   *
   * The room count is asked last of the text fields, so by then a price is already on the draft --
   * and "3" typed as an answer would otherwise have been read as a price and replaced 45000 with 3.
   * Rooms are only claimed once everything before them is filled, which is exactly when they are
   * the thing being asked for.
   */
  const awaitsRooms = Boolean(draft.area && draft.price && draft.landmark && !draft.rooms);
  const awaitsCommission = Boolean(draft.area && draft.price && draft.landmark && draft.rooms) && draft.commission === undefined;
  const priceAnswer = draft.price ? null : trimmed.match(/^\d{2,8}$/);
  const roomsAnswer = awaitsRooms ? parseRoomsAnswer(trimmed) : null;
  // Zero is a real answer here -- "no commission on this house" -- so the pattern allows it and the
  // result is compared against undefined rather than tested for truthiness.
  const commissionAnswer = awaitsCommission ? trimmed.match(/^\d{1,8}$/) : null;

  return {
    ...draft,
    type: extracted.propertyType ?? draft.type,
    area: extracted.area ?? areaFromText ?? draft.area,
    landmark: extracted.landmark ?? draft.landmark,
    // GPT reads a lone "3" as a price as readily as we did, so it is ignored while rooms are open.
    price: (awaitsRooms || awaitsCommission ? undefined : extracted.price) ?? (priceAnswer ? Number(priceAnswer[0]) : undefined) ?? draft.price,
    rooms: roomsAnswer?.rooms ?? extracted.rooms ?? draft.rooms,
    extras: roomsAnswer?.extras ?? draft.extras,
    commission: commissionAnswer ? Number(commissionAnswer[0]) : draft.commission
  };
}

/**
 * Search results while the walkthrough is open: their own listing, and nothing else.
 *
 * Mixing real listings in would mean a free reveal of a real owner's number, and would blur whose
 * house they are looking at -- which is the single thing the walkthrough exists to show them.
 */
function searchDemoListing(demo: DemoState | undefined, extracted: ReturnType<typeof extractMessage>) {
  if (!demo?.listing) {
    return [];
  }

  const wanted = extracted.area ?? extracted.searchText;
  const matches = !wanted || wanted === "__more__" || normalizeDictionaryText(demo.listing.area).includes(normalizeDictionaryText(wanted));

  return matches ? [demo.listing] : [];
}

async function searchActiveProperties(extracted: ReturnType<typeof extractMessage>): Promise<PropertyCandidate[]> {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return mockProperties
      .filter((property) => !extracted.area || property.area === extracted.area)
      .filter((property) => !extracted.propertyType || property.type === extracted.propertyType)
      .filter((property) => !extracted.maxPrice || property.price <= extracted.maxPrice)
      .slice(0, 20);
  }

  const selectColumns = "id,property_code,owner_phone,type,area,landmark,price,rooms,office_commission,description";
  let query = supabase
    .from("properties")
    .select(selectColumns)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(20);

  if (extracted.area) {
    query = query.ilike("area", `%${extracted.area}%`);
  }

  if (extracted.propertyType) {
    query = query.ilike("type", `%${extracted.propertyType}%`);
  }

  if (extracted.maxPrice) {
    query = query.lte("price", extracted.maxPrice);
  }

  if (extracted.searchText) {
    const term = extracted.searchText.replace(/[%_,]/g, "").trim();
    if (term) {
      query = query.or(`area.ilike.%${term}%,landmark.ilike.%${term}%,type.ilike.%${term}%`);
    }
  }

  let { data, error } = await query;

  if (error) {
    console.error("Failed to search active properties", error);
    return [];
  }

  if ((!data || data.length === 0) && extracted.propertyType && extracted.area) {
    let broadQuery = supabase
      .from("properties")
      .select(selectColumns)
      .eq("status", "active")
      .ilike("area", `%${extracted.area}%`)
      .order("created_at", { ascending: false })
      .limit(20);

    if (extracted.maxPrice) {
      broadQuery = broadQuery.lte("price", extracted.maxPrice);
    }

    const broad = await broadQuery;
    data = broad.data;
    error = broad.error;

    if (error) {
      console.error("Failed broad active property search", error);
      return [];
    }
  }

  if ((!data || data.length === 0) && extracted.searchText) {
    const term = extracted.searchText.replace(/[%_,]/g, "").trim();
    let fallbackQuery = supabase
      .from("properties")
      .select(selectColumns)
      .eq("status", "active")
      .or(`area.ilike.%${term}%,landmark.ilike.%${term}%,type.ilike.%${term}%`)
      .order("created_at", { ascending: false })
      .limit(20);

    if (extracted.maxPrice) {
      fallbackQuery = fallbackQuery.lte("price", extracted.maxPrice);
    }

    const fallback = await fallbackQuery;
    data = fallback.data;
    error = fallback.error;

    if (error) {
      console.error("Failed fallback active property search", error);
      return [];
    }
  }

  return (data ?? []).slice(0, 20).map((property) => ({
    id: property.id,
    propertyCode: property.property_code ?? undefined,
    ownerPhone: property.owner_phone ?? undefined,
    title: `${property.type ?? "عقار"} في ${property.area ?? "منطقة غير محددة"}`,
    type: property.type ?? "عقار",
    area: property.area ?? "غير محددة",
    landmark: property.landmark ?? "غير محدد",
    price: Number(property.price ?? 0),
    rooms: property.rooms ?? undefined,
    commission: property.office_commission ?? undefined,
    extras: property.description ?? undefined
  }));
}

// The renter may get this long after picking the house, so it repeats which one it is instead of
// sending a bare phone number.
/** Every district the bot knows: the built-in list plus whatever an admin added to the dictionary. */
export async function getActiveAreas() {
  const dictionary = await getRuntimeDictionary();

  return Array.from(new Set([...knownAreas, ...dictionary.areas]));
}

/**
 * Areas that have listings right now, busiest first.
 *
 * Used for the examples in the welcome message. A hard-coded list goes stale silently and sends a
 * brand new user's first search into an empty result, which is the worst possible first impression
 * and the one nobody reports. Falls back to the known areas when nothing is published yet.
 */
export async function getAreasWithListings(limit = 4) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return knownAreas.slice(0, limit);
  }

  const { data, error } = await supabase.from("properties").select("area").eq("status", "active");

  if (error) {
    return knownAreas.slice(0, limit);
  }

  const counts = new Map<string, number>();

  for (const row of data ?? []) {
    const area = String(row.area ?? "").trim();

    if (area) {
      counts.set(area, (counts.get(area) ?? 0) + 1);
    }
  }

  const ranked = [...counts.entries()].sort((first, second) => second[1] - first[1]).map(([area]) => area);

  return ranked.length > 0 ? ranked.slice(0, limit) : knownAreas.slice(0, limit);
}

/**
 * A district and a price to use as examples, taken from what is actually listed.
 *
 * The examples in the bot's text were written once and never revisited: it was still telling people
 * to try "أقل من 2500" while the cheapest house on the books was 45,000. An example that cannot
 * match anything is worse than none -- it sends a first-time searcher into an empty result and
 * teaches them the wrong shape of number.
 *
 * The price is the median rounded up to a round figure, so it reads like something a person would
 * type and still returns about half the listings.
 */
export async function getSearchExample() {
  const supabase = getServiceSupabase();
  const fallback = { area: knownAreas[0], maxPrice: 50000 };

  if (!supabase) {
    return fallback;
  }

  const { data, error } = await supabase.from("properties").select("area,price").eq("status", "active");

  if (error || !data || data.length === 0) {
    return fallback;
  }

  const counts = new Map<string, number>();

  for (const row of data) {
    const area = String(row.area ?? "").trim();

    if (area) {
      counts.set(area, (counts.get(area) ?? 0) + 1);
    }
  }

  const busiest = [...counts.entries()].sort((first, second) => second[1] - first[1])[0]?.[0];
  const prices = data
    .map((row) => Number(row.price))
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((first, second) => first - second);

  if (prices.length === 0) {
    return { area: busiest ?? fallback.area, maxPrice: fallback.maxPrice };
  }

  const median = prices[Math.floor(prices.length / 2)];
  const step = median >= 10000 ? 10000 : 1000;

  return { area: busiest ?? fallback.area, maxPrice: Math.ceil(median / step) * step };
}

/** The same ranking with the counts kept, for telling a searcher what is actually on the shelf. */
export async function getAreaInventory(limit = 5) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase.from("properties").select("area").eq("status", "active");

  if (error) {
    return [];
  }

  const counts = new Map<string, number>();

  for (const row of data ?? []) {
    const area = String(row.area ?? "").trim();

    if (area) {
      counts.set(area, (counts.get(area) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((first, second) => second[1] - first[1])
    .slice(0, limit)
    .map(([area, count]) => ({ area, count }));
}

function houseCount(count: number) {
  if (count === 1) return "دار واحدة";
  if (count === 2) return "دارين";

  return count <= 10 ? `${count} دور` : `${count} دار`;
}

/**
 * True when a search term is worth repeating back to the user.
 *
 * "؟" reached this message as a place name and produced "ما عندنا دور في ؟ حاليًا". A term with no
 * letters in it is not somewhere anyone lives.
 */
function looksLikePlace(text: string) {
  const trimmed = text.trim();

  // "__more__" is the sentinel for "show me the rest", not a district, and it would have been read
  // back to the user as one.
  if (trimmed === "__more__") {
    return false;
  }

  return trimmed.length >= 2 && /[ء-يA-Za-z]/.test(trimmed);
}

/**
 * What the bot says when a search comes back empty.
 *
 * The old wording named two districts chosen when the code was written, which is a promise the
 * database does not have to keep: it sent people to look where nothing was listed. This names what
 * is actually published, busiest first, so a dead end becomes a list to pick from.
 */
export async function buildNoResults(place?: string | null) {
  const inventory = await getAreaInventory();
  const named = place && looksLikePlace(place) ? place.trim() : "";

  // The heading travels with the list so both disappear together. Promising "المتوفر الآن" and then
  // showing nothing is worse than saying nothing, and an empty database is exactly when it happens.
  const available =
    inventory.length > 0
      ? ["المتوفر الآن:", ...inventory.map((item) => `• ${item.area} — ${houseCount(item.count)}`)].join("\n")
      : "";

  return getMessage("no_results", { place: named, available });
}

export type AreaNotice = {
  text: string;
  /** Empty means it covers every district that no other notice claims. */
  areas: string[];
};

export function parseAreaNotices(value: string): AreaNotice[] {
  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);

    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => item && typeof item.text === "string")
        .map((item) => ({
          text: String(item.text),
          areas: Array.isArray(item.areas) ? item.areas.map((area: unknown) => String(area)) : []
        }));
    }
  } catch {
    // Not JSON: an admin may have typed a plain notice before the editor existed.
  }

  return [{ text: trimmed, areas: [] }];
}

/** Picks the notice that claims this district, falling back to the one that claims none. */
export function resolveAreaNote(value: string, area?: string | null) {
  const wanted = area ? normalizeDictionaryText(area) : "";
  // A notice with no text is one the admin has not finished writing, never a reason to show nothing.
  const notices = parseAreaNotices(value).filter((notice) => notice.text.trim());

  if (wanted) {
    const match = notices.find((notice) =>
      notice.areas.some((item) => normalizeDictionaryText(item) === wanted)
    );

    if (match?.text.trim()) {
      return match.text.trim();
    }
  }

  return notices.find((notice) => notice.areas.length === 0)?.text.trim() ?? "";
}

export async function formatOwnerContact(selected: PropertyCandidate, note: string[] = []) {
  return [
    "╭──────────────",
    `🏠 *${selected.type ?? "دار"} في ${selected.area}*`,
    "╰──────────────",
    "",
    "💰 السعر",
    `*${formatPrice(selected.price)}*`,
    // Next to the price rather than in the fine print: it is part of what the house costs, and a
    // renter who meets it only after paying for the number has been surprised by a bill.
    ...(selected.commission
      ? ["", "🏢 عمولة المكتب", `*${formatPrice(selected.commission)}*`, commissionNote]
      : []),
    "",
    "🛏 الغرف",
    `${selected.rooms ?? "غير محدد"}`,
    ...(selected.extras ? ["", "✨ إضافات", selected.extras] : []),
    "",
    "📍 قريبة من",
    formatLandmark(selected.landmark),
    ...(selected.propertyCode ? ["", "🔖 كود الدار", `*${selected.propertyCode}*`] : []),
    "",
    "━━━━━━━━━━━━━━",
    "📱 *رقم المؤجر*",
    `*${selected.ownerPhone?.replace("whatsapp:", "")}*`,
    "",
    "🔗 محادثة مباشرة",
    `https://wa.me/${selected.ownerPhone?.replace("whatsapp:", "").replace(/\D/g, "")}`,
    ...(note.length ? ["", "━━━━━━━━━━━━━━", ...note] : [])
  ].join("\n");
}

async function createContactRequest(renterPhone: string, selected: PropertyCandidate) {
  const { contactRevealPoints } = await getSettings();
  const supabase = getServiceSupabase();

  if (!supabase || !selected.ownerPhone) {
    return { saved: false };
  }

  await supabase.from("users").upsert(
    {
      phone: renterPhone,
      role: "renter"
    },
    {
      onConflict: "phone"
    }
  );

  const { data: existing } = await supabase
    .from("contact_requests")
    .select("id,status")
    .eq("property_id", selected.id)
    .eq("renter_phone", renterPhone)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Already paid for: hand the number over again without charging a second point.
  if (existing) {
    return { saved: true, existing: true, id: existing.id as string, status: existing.status as string };
  }

  const { data, error } = await supabase
    .from("contact_requests")
    .insert({
      property_id: selected.id,
      renter_phone: renterPhone,
      owner_phone: selected.ownerPhone,
      status: "approved",
      fee_amount: contactRevealPoints
    })
    .select("id")
    .single();

  if (error) {
    console.error("Failed to create contact request", error);
    return { saved: false, error: error.message };
  }

  return { saved: true, existing: false, id: data.id as string };
}

async function getUsagePoints(phone: string) {
  const wallet = await ensureWallet(phone);

  return wallet ? Number(wallet.usage_points ?? 0) : null;
}

export async function spendPointsForListing(ownerPhone: string) {
  const supabase = getServiceSupabase();
  const { listingFeePoints: propertyListingFeePoints } = await getSettings();

  // Simulator mode: without Supabase there is no wallet to charge, so let the listing through.
  if (!supabase) {
    return {
      ok: true,
      reply: `تم خصم ${propertyListingFeePoints} أوقية (محاكاة فقط، بدون ربط قاعدة البيانات).`
    };
  }

  const wallet = await ensureWallet(ownerPhone);

  if (!wallet) {
    return {
      ok: false,
      reply: "تعذر قراءة رصيدك الآن. حاول مرة أخرى بعد قليل."
    };
  }

  const usagePoints = Number(wallet.usage_points ?? 0);

  if (usagePoints < propertyListingFeePoints) {
    return {
      ok: false,
      reply: await getPointsTopupInstructions({ currentBalance: usagePoints, purposeText: `🔐 نشر إعلان العقار يحتاج *${propertyListingFeePoints} أوقية*.` })
    };
  }

  const { error: walletError } = await supabase
    .from("user_wallets")
    .update({
      usage_points: usagePoints - propertyListingFeePoints
    })
    .eq("phone", ownerPhone);

  if (walletError) {
    console.error("Failed to spend listing points", walletError);
    return {
      ok: false,
      reply: "تعذر خصم الأوقية الآن. حاول مرة أخرى بعد قليل."
    };
  }

  const { error: ledgerError } = await supabase.from("credit_transactions").insert({
    phone: ownerPhone,
    kind: "property_listing",
    usage_points_delta: -propertyListingFeePoints,
    admin_note: "خصم أوقية نشر إعلان عقار"
  });

  if (ledgerError) {
    // The points are already gone, so keep going, but do not lose the fact silently.
    console.error("Failed to record the listing fee transaction", ledgerError);
  }

  return {
    ok: true,
    spentPoints: propertyListingFeePoints,
    remainingPoints: usagePoints - propertyListingFeePoints,
    reply: [
      `تم خصم *${propertyListingFeePoints} أوقية* من رصيدك.`,
      `رصيدك المتبقي: *${usagePoints - propertyListingFeePoints} أوقية*`
    ].join("\n")
  };
}

// The card an owner gets when their listing is published, matching the one a renter gets with an
// owner number: what the listing is, what it cost, and what is left.
export function formatListingApproval(
  property: {
    type?: string | null;
    area?: string | null;
    price?: number | null;
    rooms?: number | null;
    landmark?: string | null;
    property_code?: string | null;
    id?: string;
  },
  note: string[] = []
) {
  return [
    "╭──────────────",
    `🏠 *${property.type ?? "دار"} في ${property.area ?? "منطقة غير محددة"}*`,
    "╰──────────────",
    "",
    "💰 السعر",
    `*${property.price ? formatPrice(Number(property.price)) : "غير محدد"}*`,
    "",
    "🛏 الغرف",
    `${property.rooms ?? "غير محدد"}`,
    "",
    "📍 قريبة من",
    property.landmark ? formatLandmark(property.landmark) : "غير محدد",
    "",
    "🔖 رقم الإعلان",
    `*${property.property_code ?? property.id?.slice(0, 8) ?? "غير محدد"}*`,
    "",
    "━━━━━━━━━━━━━━",
    "✅ *تمت الموافقة ونُشر إعلانك*",
    "صار ظاهرًا للمستأجرين في نتائج البحث.",
    ...(note.length ? ["", "━━━━━━━━━━━━━━", ...note] : [])
  ].join("\n");
}

async function spendPointForContact(renterPhone: string, selected: PropertyCandidate) {
  const { contactRevealPoints } = await getSettings();
  const supabase = getServiceSupabase();
  const wallet = await ensureWallet(renterPhone);

  if (!supabase || !wallet) {
    return {
      ok: false,
      reply: "تعذر قراءة رصيدك الآن. حاول مرة أخرى بعد قليل."
    };
  }

  const usagePoints = Number(wallet.usage_points ?? 0);

  if (usagePoints < contactRevealPoints) {
    return {
      ok: false,
      reason: "insufficient_points" as const,
      reply: await getPointsTopupInstructions({ currentBalance: usagePoints })
    };
  }

  const request = await createContactRequest(renterPhone, selected);

  if (!request.saved) {
    return {
      ok: false,
      reply: "تعذر إنشاء طلب التواصل الآن. حاول مرة أخرى بعد قليل."
    };
  }

  const { error: walletError } = await supabase
    .from("user_wallets")
    .update({
      usage_points: usagePoints - contactRevealPoints
    })
    .eq("phone", renterPhone);

  if (walletError) {
    console.error("Failed to spend contact point", walletError);
    return {
      ok: false,
      reply: "تعذر خصم الأوقية الآن. حاول مرة أخرى بعد قليل."
    };
  }

  await supabase.from("credit_transactions").insert({
    phone: renterPhone,
    kind: "contact_reveal",
    usage_points_delta: -contactRevealPoints,
    related_contact_request_id: request.id,
    admin_note: "خصم أوقية لطلب رقم المؤجر"
  });

  return {
    ok: true,
    id: request.id,
    reply: await formatOwnerContact(selected, [
      ...(request.existing ? ["🔁 طلب مكرر لنفس الدار."] : []),
      `تم خصم *${contactRevealPoints} أوقية* من رصيدك.`,
      `رصيدك المتبقي: *${usagePoints - contactRevealPoints} أوقية*`,
      "",
      "🎁 ادعُ أصدقاءك واكسب رصيدًا مجانيًا — اكتب: *إحالاتي*"
    ])
  };
}

// Called after an admin approves a top-up, so a renter who ran out of points gets the owner number
// without having to ask again.
export async function fulfillPendingContactRequest(phone: string) {
  const state = await getConversationState(phone);
  const pending = state.pendingContactProperty;

  if (!pending) {
    return null;
  }

  const request = await spendPointForContact(phone, pending);

  if (!request.ok) {
    // Keep it pending: the balance may still be short, and a later top-up should retry.
    return null;
  }

  await setConversationState(phone, {
    ...state,
    pendingContactProperty: undefined,
    awaitingContactChoice: false,
    activeContactRequestId: request.id
  });

  return request.reply;
}

/** Creates the user row and the wallet when either is missing, and returns the wallet. */
export async function ensureWallet(phone: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return null;
  }

  await supabase.from("users").upsert(
    {
      phone,
      role: "renter"
    },
    {
      onConflict: "phone",
      ignoreDuplicates: true
    }
  );

  const { data: existing, error: existingError } = await supabase
    .from("user_wallets")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();

  if (existingError) {
    console.error("Failed to load wallet", existingError);
    return null;
  }

  if (existing) {
    return existing;
  }

  const { data, error } = await supabase
    .from("user_wallets")
    .insert({
      phone
    })
    .select("*")
    .single();

  if (error) {
    console.error("Failed to create wallet", error);
    return null;
  }

  return data;
}

async function applyReferralCode(phone: string, body: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return undefined;
  }

  const referralCode = findReferralCode(body);

  if (!referralCode) {
    return undefined;
  }

  const wallet = await ensureWallet(phone);

  if (!wallet) {
    return "تعذر تسجيل كود الدعوة الآن. حاول مرة أخرى بعد قليل.";
  }

  if (wallet.referred_by_phone) {
    return "تم تسجيلك سابقًا عبر كود دعوة. لا يمكن تغيير المحيل بعد التسجيل.";
  }

  if (String(wallet.referral_code ?? "") === referralCode) {
    return "لا يمكن استخدام كود دعوتك لنفسك.";
  }

  const { data: referrer, error } = await supabase
    .from("user_wallets")
    .select("phone")
    .eq("referral_code", referralCode)
    .maybeSingle();

  if (error || !referrer) {
    return "كود الدعوة غير صحيح. تأكد من الكود وأرسله مرة أخرى.";
  }

  const { error: updateError } = await supabase
    .from("user_wallets")
    .update({
      referred_by_phone: referrer.phone,
      referred_at: new Date().toISOString()
    })
    .eq("phone", phone);

  if (updateError) {
    console.error("Failed to apply referral code", updateError);
    return "تعذر تسجيل كود الدعوة الآن. حاول مرة أخرى بعد قليل.";
  }

  const { referralCommissionPercent, referralWelcomePoints, referralSignupBonusPoints } = await getSettings();

  // A welcome grant makes the marketer's pitch concrete ("سجل عن طريقي وخذ أول رقم مجانًا") and
  // costs the marketer nothing to keep track of.
  if (referralWelcomePoints > 0) {
    const { error: grantError } = await supabase
      .from("user_wallets")
      .update({ usage_points: Number(wallet.usage_points ?? 0) + referralWelcomePoints })
      .eq("phone", phone);

    if (grantError) {
      console.error("Failed to grant referral welcome points", grantError);
    } else {
      const { error: ledgerError } = await supabase.from("credit_transactions").insert({
        phone,
        kind: "admin_adjustment",
        usage_points_delta: referralWelcomePoints,
        related_phone: referrer.phone,
        admin_note: "أوقية ترحيب للتسجيل عبر دعوة"
      });

      if (ledgerError) {
        console.error("Failed to record the welcome grant", ledgerError);
      }
    }
  }

  // Something in hand the moment a referral lands, rather than only after the referred person pays.
  if (referralSignupBonusPoints > 0) {
    const { data: referrerWallet } = await supabase
      .from("user_wallets")
      .select("usage_points")
      .eq("phone", referrer.phone)
      .maybeSingle();

    if (referrerWallet) {
      const { error: bonusError } = await supabase
        .from("user_wallets")
        .update({ usage_points: Number(referrerWallet.usage_points ?? 0) + referralSignupBonusPoints })
        .eq("phone", referrer.phone);

      if (bonusError) {
        console.error("Failed to grant the referral signup bonus", bonusError);
      } else {
        await supabase.from("credit_transactions").insert({
          phone: referrer.phone,
          kind: "admin_adjustment",
          usage_points_delta: referralSignupBonusPoints,
          related_phone: phone,
          admin_note: "مكافأة تسجيل إحالة"
        });
      }
    }
  }

  // Told as it happens, so the marketer can chase the first top-up while the contact is still warm.
  await sendNotification(
    referrer.phone as string,
    [
      "🎯 *شخص جديد سجّل عن طريق رابطك!*",
      "",
      ...(referralWelcomePoints > 0 ? [`استلم *${referralWelcomePoints} أوقية* لتجربة الخدمة.`] : []),
      ...(referralSignupBonusPoints > 0
        ? [`🎁 وكسبت أنت *${referralSignupBonusPoints} أوقية* استخدام فورًا.`]
        : []),
      "",
      `💰 وعند أول شحنة يقوم بها تحصل على *${referralCommissionPercent}%* عمولة قابلة للسحب.`,
      "",
      "📌 لمتابعة إحالاتك اكتب: *إحالاتي*"
    ].join("\n"),
    "referral_signup"
  );

  // The referrer's commission used to be spelled out here. It is not the new user's business, and
  // reading that someone earns a cut of what you spend is a strange first impression. What they
  // need instead is what to type next.
  return getMessage("referral_welcome", {
    points: referralWelcomePoints > 0 ? referralWelcomePoints : undefined,
    areas: (await getAreasWithListings()).join("، ")
  });
}

async function getWalletReply(phone: string) {
  const { minimumWithdrawalPoints } = await getSettings();
  const wallet = await ensureWallet(phone);

  if (!wallet) {
    return "تعذر تحميل رصيدك الآن. حاول مرة أخرى بعد قليل.";
  }

  const usagePoints = Number(wallet.usage_points ?? 0);
  const commissionPoints = Number(wallet.commission_points ?? 0);
  const remaining = Math.max(minimumWithdrawalPoints - commissionPoints, 0);
  const referralCode = (await getOrCreateReferralCode(phone)) ?? "—";

  return [
    "╭──────────────",
    "💼 *محفظتك في الديارة*",
    "╰──────────────",
    "",
    "🏠 رصيد الاستخدام",
    `*${usagePoints} أوقية*`,
    "",
    "📣 رصيد التسويق",
    `*${commissionPoints} أوقية*`,
    "",
    "━━━━━━━━━━━━━━",
    "💸 السحب",
    `الحد الأدنى: *${minimumWithdrawalPoints} أوقية*`,
    remaining > 0 ? `المتبقي: *${remaining} أوقية*` : "يمكنك طلب السحب الآن. اكتب: *طلب سحب*",
    "",
    "━━━━━━━━━━━━━━",
    "🔗 رابط دعوتك",
    await makeReferralLink(referralCode)
  ].join("\n");
}

// A blocked number gets one explanation and nothing else. Runs before any state is read or written
// so a blocked user cannot keep a draft or a search alive.
async function isBlocked(phone: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return false;
  }

  const { data, error } = await supabase
    .from("users")
    .select("blocked_at")
    .eq("phone", phone)
    .maybeSingle();

  if (error) {
    // A missing column means blocking was never migrated in, so nobody is blocked.
    if (!error.message?.includes("blocked_at")) {
      console.error("Failed to read the block state", error);
    }

    return false;
  }

  return Boolean(data?.blocked_at);
}

async function getOwnerListingsReply(ownerPhone: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return "تعذر قراءة عقاراتك الآن. حاول مرة أخرى بعد قليل.";
  }

  const { data, error } = await supabase
    .from("properties")
    .select("status,property_code,area,price,landmark")
    .eq("owner_phone", ownerPhone);

  if (error) {
    console.error("Failed to read owner listings", error);
    return "تعذر قراءة عقاراتك الآن. حاول مرة أخرى بعد قليل.";
  }

  const listings = data ?? [];

  if (listings.length === 0) {
    return [
      "📋 *ملخص عقاراتك في الديارة*",
      "",
      "ما عندك أي عقار مسجل حتى الآن.",
      "",
      'اكتب "عندي دار للإيجار" لإضافة عقار جديد.'
    ].join("\n");
  }

  const countBy = (status: string) => listings.filter((item) => item.status === status).length;
  const rented = countBy("rented");
  const active = countBy("active");
  const pending = countBy("pending_review");
  const rejected = countBy("rejected");
  const hidden = countBy("hidden");

  // The rented command takes a listing number, so the summary has to show those numbers. Otherwise
  // an owner who no longer has the approval message cannot name the house they just rented out.
  const published = listings.filter((item) => item.status === "active");

  return [
    "📋 *ملخص عقاراتك في الديارة*",
    "",
    `🏠 إجمالي العقارات: ${listings.length}`,
    `✅ منشورة ومتاحة الآن: ${active}`,
    `⏳ قيد المراجعة: ${pending}`,
    `🔒 مؤجرة حاليًا: ${rented}`,
    ...(hidden > 0 ? [`🙈 مخفية: ${hidden}`] : []),
    ...(rejected > 0 ? [`❌ مرفوضة: ${rejected}`] : []),
    ...(published.length > 0
      ? [
          "",
          "━━━━━━━━━━━━━━",
          "🏘 *المنشورة الآن*",
          // The landmark is what an owner recognises. A code and a district do not separate two
          // houses in the same district, which is exactly when naming the wrong one costs a listing.
          ...published.map((item) =>
            [
              `*${item.property_code ?? "—"}* — ${item.area ?? "منطقة غير محددة"}${
                item.price ? ` — ${formatPrice(Number(item.price))}` : ""
              }`,
              ...(item.landmark ? [`   📍 ${formatLandmark(String(item.landmark))}`] : [])
            ].join("\n")
          ),
          "",
          published.length === 1
            ? "إذا أجّرتها اكتب: *تم تأجير*"
            : "إذا أجّرت واحدة اكتب: *تم تأجير* ثم رقمها، مثلا: *تم تأجير " + published[0].property_code + "*"
        ]
      : []),
    "",
    'اكتب "عندي دار للإيجار" لإضافة عقار جديد.'
  ].join("\n");
}

// The owner marks their own listing as rented, so it leaves search results immediately instead of
// waiting for an admin.
async function markListingRented(ownerPhone: string, reference: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return "تعذر تحديث العقار الآن. حاول مرة أخرى بعد قليل.";
  }

  const code = reference.trim();

  const { data: listings, error } = await supabase
    .from("properties")
    .select("id,property_code,status,area,type")
    .eq("owner_phone", ownerPhone)
    .in("status", ["active", "pending_review", "hidden"]);

  if (error) {
    console.error("Failed to look up the owner listing", error);
    return "تعذر تحديث العقار الآن. حاول مرة أخرى بعد قليل.";
  }

  const candidates = listings ?? [];
  const target =
    candidates.find((item) => String(item.property_code ?? "") === code) ??
    candidates.find((item) => String(item.id).startsWith(code)) ??
    (candidates.length === 1 && !code ? candidates[0] : undefined);

  if (!target) {
    return [
      "ما لقيت إعلانًا بهذا الرقم باسمك.",
      "",
      'اكتب "إجاراتي" لعرض عقاراتك وأرقام إعلاناتها.'
    ].join("\n");
  }

  const { error: updateError } = await supabase
    .from("properties")
    .update({ status: "rented", updated_at: new Date().toISOString() })
    .eq("id", target.id);

  if (updateError) {
    console.error("Failed to mark the listing as rented", updateError);
    return "تعذر تحديث العقار الآن. حاول مرة أخرى بعد قليل.";
  }

  const cancelled = await cancelContactRequestsForProperty(String(target.id));

  return [
    "✅ *تم تحديث الإعلان*",
    "",
    `🏠 ${target.type ?? "دار"} في ${target.area ?? "منطقة غير محددة"}`,
    `🔖 رقم الإعلان: *${target.property_code ?? String(target.id).slice(0, 8)}*`,
    "",
    "صار مؤجَّرًا ولم يعد يظهر في نتائج البحث.",
    ...(cancelled > 0 ? ["", `أبلغنا *${cancelled}* مستأجرًا كانوا مهتمين بأن الدار لم تعد متاحة.`] : []),
    "",
    'لإعادة عرضه لاحقًا تواصل مع الإدارة، أو اكتب "عندي دار للإيجار" لإضافة عقار جديد.'
  ].join("\n");
}

/**
 * Tells the renters still chasing a property that just left the market.
 *
 * A contact request is created already approved, so there is no in-flight row to close here: the
 * only people left waiting are those who were asked to top up and have the property held in their
 * conversation state.
 */
async function cancelContactRequestsForProperty(propertyId: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return 0;
  }

  const notified = new Set<string>();

  // Renters who were told to top up before paying still hold this property in their state.
  const { data: waiting } = await supabase
    .from("conversation_states")
    .select("phone,state")
    .filter("state->pendingContactProperty->>id", "eq", propertyId);

  for (const row of waiting ?? []) {
    const state = (row.state ?? {}) as ConversationState;

    await setConversationState(String(row.phone), {
      ...state,
      pendingContactProperty: undefined,
      awaitingContactChoice: undefined
    });

    notified.add(String(row.phone));
  }

  for (const phone of notified) {
    await sendNotification(
      phone,
      [
        "🔒 *الدار التي كنت مهتمًا بها لم تعد متاحة*",
        "",
        "تم تأجيرها للتو، وألغينا طلبك دون خصم أي أوقية.",
        "",
        "اكتب المنطقة التي تبحث فيها ونعرض لك خيارات أخرى."
      ].join("\n"),
      "property_rented"
    );
  }

  return notified.size;
}

/** Enough of the number for the marketer to recognise who it is, without handing them the rest. */
function maskPhone(phone: string) {
  const digits = normalizePhoneDigits(phone);

  return digits.length > 7 ? `+${digits.slice(0, 3)}•••${digits.slice(-4)}` : `•••${digits.slice(-4)}`;
}

type ReferralRow = {
  phone: string;
  topups: number;
  commission: number;
};

/** Reads every referral of one marketer in three queries rather than one per person. */
async function loadReferrals(phone: string): Promise<ReferralRow[] | null> {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return null;
  }

  const { data: referred, error } = await supabase
    .from("user_wallets")
    .select("phone,referred_at")
    .eq("referred_by_phone", phone)
    .order("referred_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("Failed to read referrals", error);
    return null;
  }

  const phones = (referred ?? []).map((row) => row.phone as string);

  if (phones.length === 0) {
    return [];
  }

  const [{ data: topups }, { data: commissions }] = await Promise.all([
    supabase.from("credit_topups").select("phone").eq("status", "approved").in("phone", phones),
    supabase
      .from("credit_transactions")
      .select("related_phone,commission_points_delta")
      .eq("phone", phone)
      .eq("kind", "referral_commission")
  ]);

  const topupCounts = new Map<string, number>();
  const commissionTotals = new Map<string, number>();

  for (const row of topups ?? []) {
    const key = String(row.phone);
    topupCounts.set(key, (topupCounts.get(key) ?? 0) + 1);
  }

  for (const row of commissions ?? []) {
    const key = String(row.related_phone ?? "");
    commissionTotals.set(key, (commissionTotals.get(key) ?? 0) + Number(row.commission_points_delta ?? 0));
  }

  return phones.map((item) => ({
    phone: item,
    topups: topupCounts.get(item) ?? 0,
    commission: commissionTotals.get(item) ?? 0
  }));
}

/**
 * The message a marketer forwards. Ready to copy whole, because asking someone to compose their own
 * pitch is where sharing stops.
 */
async function buildShareMessage(link: string, welcomePoints: number) {
  return getMessage("referral_pitch", {
    // Zero welcome points empties the variable, which drops its whole line from the pitch.
    welcomePoints: welcomePoints > 0 ? welcomePoints : undefined,
    link
  });
}

// One card with everything a marketer acts on: who paid, what that earned, and the link to share.
async function getReferralSummary(phone: string) {
  const { minimumWithdrawalPoints, referralCommissionPercent, referralWelcomePoints: welcomePoints } =
    await getSettings();
  const referralCode = (await getOrCreateReferralCode(phone)) ?? "—";
  const link = await makeReferralLink(referralCode);
  const wallet = await ensureWallet(phone);
  const commissionPoints = Number(wallet?.commission_points ?? 0);
  const referrals = await loadReferrals(phone);

  const paid = referrals?.filter((row) => row.topups > 0).length ?? 0;
  const waiting = (referrals?.length ?? 0) - paid;
  const missing = Math.max(minimumWithdrawalPoints - commissionPoints, 0);

  const summary = [
    "👥 *إحالاتك*",
    "",
    `💰 دفعوا: *${paid}*`,
    `📝 سجلوا ولم يشحنوا: *${waiting}*`,
    "",
    "━━━━━━━━━━━━━━",
    `💵 عمولتك: *${commissionPoints} أوقية*`,
    missing > 0
      ? `🎯 باقي *${missing} أوقية* حتى تقدر تسحب.`
      : "✅ تقدر تسحب الآن — اكتب: *طلب سحب*",
    "",
    "━━━━━━━━━━━━━━",
    `📣 تحصل على *${referralCommissionPercent}%* من كل شحنة يقوم بها من سجّل عن طريقك.`,
    "",
    "👇 الرسالة الجاهزة للإرسال في الرسالة التالية — اضغط عليها مطولًا ثم *تحويل* أو *نسخ*.",
    ...(paid + waiting > 0 ? ["", "اكتب *تفاصيل إحالاتي* لقائمة من سجّل."] : [])
  ].join("\n");

  // Sent on its own so a long press copies or forwards exactly the pitch and nothing else.
  const share = await buildShareMessage(link, welcomePoints);

  return { summary, share };
}

async function getReferralDetails(phone: string) {
  const referrals = await loadReferrals(phone);

  if (referrals === null) {
    return "تعذر قراءة إحالاتك الآن. حاول مرة أخرى بعد قليل.";
  }

  if (referrals.length === 0) {
    return ["📋 *تفاصيل إحالاتك*", "", "ما سجّل أحد عن طريقك بعد.", "", "اكتب *إحالاتي* للحصول على رابطك."].join("\n");
  }

  // Whoever paid comes first: that is the part tied to the marketer's earnings.
  const ordered = [...referrals].sort((first, second) => second.topups - first.topups || second.commission - first.commission);

  return [
    "📋 *تفاصيل إحالاتك*",
    "",
    ...ordered.map((row, index) =>
      row.topups > 0
        ? `${index + 1}. ${maskPhone(row.phone)} — ✅ دفع (${row.topups === 1 ? "شحنة واحدة" : `${row.topups} شحنات`}، عمولتك ${row.commission} أوقية)`
        : `${index + 1}. ${maskPhone(row.phone)} — ⏳ سجل، ما شحن بعد`
    ),
    "",
    "اكتب *إحالاتي* للملخص والرابط."
  ].join("\n");
}

async function createWithdrawalRequest(phone: string) {
  const { minimumWithdrawalPoints } = await getSettings();
  const supabase = getServiceSupabase();
  const wallet = await ensureWallet(phone);

  if (!supabase || !wallet) {
    return "تعذر إنشاء طلب السحب الآن. حاول مرة أخرى بعد قليل.";
  }

  const commissionPoints = Number(wallet.commission_points ?? 0);

  if (commissionPoints < minimumWithdrawalPoints) {
    return [
      `رصيد التسويق عندك: *${commissionPoints} أوقية*`,
      `الحد الأدنى للسحب: *${minimumWithdrawalPoints} أوقية*`,
      "",
      `باقي لك *${minimumWithdrawalPoints - commissionPoints} أوقية* حتى تقدر تطلب السحب.`
    ].join("\n");
  }

  const { data: existing } = await supabase
    .from("withdrawal_requests")
    .select("id,status")
    .eq("phone", phone)
    .eq("status", "pending")
    .maybeSingle();

  if (existing) {
    return "عندك طلب سحب قيد المراجعة بالفعل. الإدارة ستراجعه قريبًا.";
  }

  const { error } = await supabase.from("withdrawal_requests").insert({
    phone,
    points: commissionPoints,
    status: "pending"
  });

  if (error) {
    console.error("Failed to create withdrawal request", error);
    return "تعذر إنشاء طلب السحب الآن. حاول مرة أخرى بعد قليل.";
  }

  await notifyAdmins([
    "💸 *طلب سحب عمولة جديد*",
    "",
    `📱 من: ${phone.replace("whatsapp:", "")}`,
    `📣 الأوقية المطلوبة: ${commissionPoints} أوقية`,
    "",
    "افتح لوحة الإدارة ← الأرصدة والإحالات لتسويته."
  ]);

  return [
    "تم استلام طلب السحب.",
    "",
    `الأوقية المطلوبة للسحب: *${commissionPoints} أوقية*`,
    "سيتم مراجعة الطلب من الإدارة."
  ].join("\n");
}

async function createCreditTopupRequest(phone: string, receiptUrl: string) {
  const supabase = getServiceSupabase();
  const wallet = await ensureWallet(phone);

  if (!supabase || !wallet) {
    return "وصل الإيصال، لكن تعذر حفظ طلب الشحن الآن. حاول مرة أخرى بعد قليل.";
  }

  const { error } = await supabase.from("credit_topups").insert({
    phone,
    receipt_image_url: receiptUrl,
    status: "pending"
  });

  if (error) {
    console.error("Failed to create credit topup", error);
    return "وصل الإيصال، لكن تعذر حفظ طلب الشحن الآن. حاول مرة أخرى بعد قليل.";
  }

  const senderDigits = phone.replace("whatsapp:", "").replace(/\D/g, "");

  await notifyAdmins([
    "💳 *طلب شحن أوقية جديد*",
    "",
    `📱 من: ${senderDigits}`,
    `💼 رصيده الحالي: ${Number(wallet.usage_points ?? 0)} أوقية`,
    "",
    "━━━━━━━━━━━━━━",
    "للاعتماد من هنا مباشرة، اكتب الأمر مع المبلغ بالأوقية:",
    `*شحن ${senderDigits} 2000*`,
    "",
    "🧾 لمشاهدة صورة الإيصال افتح لوحة الإدارة ← الأرصدة والإحالات."
  ]);

  return getMessage("topup_received");
}

async function getPropertyVideoUrl(propertyId: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return undefined;
  }

  const { data, error } = await supabase
    .from("property_media")
    .select("storage_url")
    .eq("property_id", propertyId)
    .eq("type", "video")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to fetch property video", error);
    return undefined;
  }

  const stored = data?.storage_url as string | undefined;

  if (!stored) {
    return undefined;
  }

  // The bucket is private, so what is stored is a path. Sending it raw is what put
  // "22244974444/1788127687522.mp4" in front of a renter who asked to see the house.
  return (await signPropertyMedia(stored)) ?? undefined;
}

export function buildContextHint(state: Awaited<ReturnType<typeof getConversationState>>) {
  if (state.draftProperty && !state.draftProperty.awaitingConfirmation) {
    const draft = state.draftProperty;

    if (!draft.area) {
      return "البوت سأل المستخدم للتو عن منطقة عقاره الذي يريد عرضه للإيجار (يملكه). اعتبر أي رد نصي بسيط (اسم منطقة) استكمالاً لإضافة العقار (add_property)، وليس بحثاً جديداً.";
    }

    if (!draft.price) {
      return "البوت سأل المستخدم للتو عن سعر إيجار العقار الذي يعرضه (يملكه). اعتبر أي رقم أو رد نصي استكمالاً لإضافة العقار (add_property).";
    }

    if (draft.rooms && draft.commission === undefined) {
      return "البوت سأل المستخدم للتو عن مبلغ عمولة المكتب لعقاره. الرقم المجرد هو العمولة، وليس سعراً ولا اختياراً من نتائج بحث. النية تبقى add_property.";
    }

    if (draft.landmark && !draft.rooms) {
      return "البوت سأل المستخدم للتو عن عدد غرف العقار الذي يعرضه (يملكه). الرقم المجرد هو عدد الغرف (rooms)، وليس سعراً ولا اختياراً من نتائج بحث. النية تبقى add_property.";
    }

    if (!draft.landmark) {
      return [
        "البوت سأل المستخدم للتو عن أقرب معلم لعقاره الذي يعرضه (يملكه). اعتبر أي رد نصي استكمالاً لإضافة العقار (add_property)، وليس بحثاً جديداً أو منطقة بحث.",
        "مهم: أسماء المعالم هنا تحتوي غالباً على اسم مقاطعة (مثل: كراج لكصر، سوق تفرغ زينة، مستشفى عرفات). وجود اسم منطقة داخل الجواب لا يعني بحثاً إطلاقاً، والنية تبقى add_property، وضع النص كاملاً في landmark ولا تضعه في area."
      ].join("\n");
    }
  }

  if (state.pendingSearch && !state.pendingSearch.area) {
    return "البوت سأل المستخدم للتو عن المنطقة التي يبحث فيها عن عقار للإيجار. اعتبر أي رد نصي بسيط (اسم منطقة) استكمالاً للبحث (search_property)، إلا إذا صرح المستخدم بوضوح أنه يملك عقاراً (عندي/لدي).";
  }

  if (state.awaitingContactChoice) {
    return "البوت ينتظر من المستخدم اختيار 1 (لطلب رقم المؤجر) أو 2 (لمشاهدة الفيديو).";
  }

  if (state.awaitingMaxPriceFilter) {
    return "البوت سأل المستخدم عن الحد الأقصى للسعر لتصفية نتائج بحث سابق.";
  }

  return undefined;
}

const knownPropertyTypes = ["شقة", "منزل", "فيلا", "غرفة", "محل", "مكتب"];

// Words that describe *what* is wanted, never *where*. GPT often returns them inside searchText
// ("منزل للايجار"), which would otherwise be searched as if it were a place name.
const genericSearchWords = [
  ...knownPropertyTypes,
  "شقه",
  "غرفه",
  "دار",
  "بيت",
  "سكن",
  "عقار",
  "للإيجار",
  "للايجار",
  "الإيجار",
  "الايجار",
  "إيجار",
  "ايجار",
  "للكراء",
  "الكراء",
  "كراء",
  "في",
  "عن",
  "ابحث",
  "أبحث",
  "نبحث",
  "ندور",
  "اريد",
  "أريد"
];

function stripGenericSearchWords(text: string) {
  return text
    .split(/\s+/)
    .filter((word) => word && !genericSearchWords.includes(word))
    .join(" ")
    .trim();
}

// A searchText made only of generic words names no place. Dropping it makes the search branch
// ask for the area instead of querying the database for "منزل للايجار" and reporting no results.
export function normalizeGenericSearchText(extracted: ExtractedMessage): ExtractedMessage {
  const rawSearchText = extracted.searchText?.trim();

  if (!rawSearchText || stripGenericSearchWords(rawSearchText)) {
    return extracted;
  }

  return {
    ...extracted,
    propertyType: extracted.propertyType ?? knownPropertyTypes.find((type) => rawSearchText.includes(type)),
    searchText: undefined
  };
}

/**
 * Marks every reply sent while the walkthrough is open.
 *
 * Explaining the difference once at the end is not enough: what someone remembers is what they saw
 * at each step, and a marketer who remembers "the listing went live immediately" will say exactly
 * that to a landlord. Wrapping here rather than at each return means a step added later cannot
 * forget the mark.
 */
async function withDemoMark(phone: string, result: Promise<ConversationResult>): Promise<ConversationResult> {
  const answer = await result;
  const state = await getConversationState(phone);

  if (!state.demo || answer.reply.startsWith(demoMark)) {
    return answer;
  }

  return { ...answer, reply: markDemo(answer.reply) };
}

/**
 * One intake conversation: which side, which district, what price, what it is.
 *
 * Saved the moment the last answer arrives, with no confirmation step. Every step drops some of the
 * people who started it, and at this stage the count is the whole point -- a wrong entry can be
 * corrected, an abandoned one cannot be recovered.
 */
async function handleCollection(
  message: IncomingWhatsAppMessage,
  current: CollectState | undefined
): Promise<ConversationResult> {
  const body = message.body.trim();

  // Media is not asked for here and cannot be answered with, so it is turned away kindly rather than
  // falling into the listing or receipt handlers that no longer apply.
  if (message.media.length > 0) {
    const audio = message.media.some((item) => item.contentType.startsWith("audio/"));

    return {
      debugIntent: "unknown",
      reply: await getMessage(audio ? "voice_not_supported" : "collect_media")
    };
  }

  // Starting again: someone with a second house, or a second district to search.
  if (/^(دار ثانية|دار ثانيه|طلب ثاني|طلب ثانية|جديد|من جديد|ابدا من جديد)$/i.test(body)) {
    await setConversationState(message.from, { collect: {} });

    return { debugIntent: "intro", reply: await getMessage("collect_start") };
  }

  const state: CollectState = { ...(current ?? {}) };
  const asked = nextCollectQuestion(state);

  if (asked === "side") {
    const dictionary = await getRuntimeDictionary();
    const side = readSide(body, {
      owner: dictionary.ownerListingPhrases,
      renter: dictionary.renterSearchPhrases
    });

    if (!side) {
      /**
       * Three different people reach this line, and telling them apart is the whole of it.
       *
       * Someone who has already registered and is adding a detail was being welcomed as a stranger,
       * which reads as the bot having forgotten them a minute after saving their request. Someone
       * opening with السلام عليكم was answered with a form and no greeting at all.
       */
      const saved = current?.done;

      await setConversationState(message.from, { collect: saved ? current : {} });

      if (saved) {
        return { debugIntent: "intro", reply: await getMessage("collect_after_saved") };
      }

      /**
       * A greeting is never "ما فهمت قصدك".
       *
       * Someone who wrote سلام was answered "وعليكم السلام، ما فهمت قصدك" -- told in one breath that
       * they had been understood and that they had not. A greeting is not an answer, but it is not a
       * failure either, so it gets the welcome and the options rather than the reproach.
       */
      const greeting = isGreetingOnly(body);
      const opening = await getMessage(current && !greeting ? "collect_unclear" : "collect_start");

      return {
        debugIntent: "intro",
        reply: greeting ? `${salutationFor(body)}

${opening}` : opening
      };
    }

    state.side = side;
    await setConversationState(message.from, { collect: state });

    return {
      debugIntent: side === "owner" ? "add_property" : "search_property",
      reply: await getMessage(side === "owner" ? "collect_owner_area" : "collect_renter_area")
    };
  }

  const owner = state.side === "owner";

  if (asked === "area") {
    if (!body) {
      return { debugIntent: "unknown", reply: await getMessage(owner ? "collect_owner_area" : "collect_renter_area") };
    }

    /**
     * A number is not a district, and accepting one cost two answers rather than one.
     *
     * The entry was saved under a district called "2", and the place they actually meant arrived on
     * the next message -- where it was read as a failed price and discarded.
     */
    if (!looksLikeArea(body)) {
      return { debugIntent: "unknown", reply: await getMessage("collect_area_not_a_number") };
    }

    // Taken as written, unknown districts included: at this stage every request counts, and one in a
    // district nobody covers yet is the most useful thing on the sheet.
    state.area = body;
    await setConversationState(message.from, { collect: state });

    return {
      debugIntent: "add_property",
      reply: await getMessage(owner ? "collect_owner_price" : "collect_renter_price")
    };
  }

  if (asked === "price") {
    const price = readPrice(body);

    if (price === undefined) {
      return {
        debugIntent: "unknown",
        reply: await getMessage(owner ? "collect_owner_price" : "collect_renter_price")
      };
    }

    state.price = price;
    await setConversationState(message.from, { collect: state });

    return {
      debugIntent: "add_property",
      reply: await getMessage(owner ? "collect_owner_specs" : "collect_renter_specs")
    };
  }

  if (asked === "specs") {
    const specs = readSpecs(body);

    if (!specs.specs) {
      return {
        debugIntent: "unknown",
        reply: await getMessage(owner ? "collect_owner_specs" : "collect_renter_specs")
      };
    }

    state.specs = specs.specs;
    state.rooms = specs.rooms;

    // A renter has no commission to name, so their entry is complete here.
    if (owner) {
      await setConversationState(message.from, { collect: state });

      return { debugIntent: "add_property", reply: await getMessage("collect_owner_commission") };
    }
  }

  if (asked === "commission") {
    const commission = readPrice(body);

    if (commission === undefined) {
      return { debugIntent: "unknown", reply: await getMessage("collect_owner_commission") };
    }

    state.commission = commission;
  }

  const saved = await saveCollectionEntry({
    phone: message.from,
    side: state.side ?? "renter",
    area: state.area ?? "",
    price: state.price,
    specs: state.specs,
    rooms: state.rooms,
    commission: state.commission
  });

  // The answers go, the fact that they registered stays: the next message is far more often a
  // clarification than a second house, and being welcomed as a stranger after registering reads as
  // the bot having forgotten them.
  await setConversationState(message.from, { collect: { done: true } });

  const amount = state.price ? formatPrice(state.price) : "";
  const commission = state.commission ? `عمولة ${formatPrice(state.commission)}` : "";
  const summary = [owner ? amount : amount && `حتى ${amount}`, state.specs, commission]
    .filter(Boolean)
    .join(" · ");

  return {
    debugIntent: owner ? "add_property" : "search_property",
    reply: await getMessage(owner ? "collect_owner_saved" : "collect_renter_saved", {
      area: state.area ?? "",
      summary,
      /**
       * The number the database gave this row, or nothing.
       *
       * Its line disappears whole when it is empty, so a database that has not run the migration
       * yet sends the same message it sent yesterday rather than one with a gap in it.
       */
      code: saved.code ?? undefined
    })
  };
}

export async function handleIncomingMessage(message: IncomingWhatsAppMessage): Promise<ConversationResult> {
  return withDemoMark(message.from, runConversation(message));
}

async function runConversation(message: IncomingWhatsAppMessage): Promise<ConversationResult> {
  const dictionary = await getRuntimeDictionary();
  const activeAreas = [...knownAreas, ...dictionary.areas];
  if (await isBlocked(message.from)) {
    return {
      debugIntent: "unknown",
      reply: [
        "⛔ *حسابك موقوف حاليًا*",
        "",
        "لا يمكنك استخدام الديارة في الوقت الحالي.",
        "",
        "إذا كنت ترى أن هذا خطأ، تواصل مع الإدارة."
      ].join("\n")
    };
  }

  // Admin instructions run before any conversation state is touched. Anything that is not a command
  // returns null, so an admin can still use the bot as a renter or an owner with the same number.
  const adminReply = await handleAdminCommand(message.from, message.body);

  if (adminReply) {
    return { debugIntent: "intro", reply: adminReply };
  }

  /**
   * A person is answering this number, so the bot says nothing.
   *
   * Checked before the state is read: everything below reads the message as an answer to a question
   * the bot asked, and someone replying to a human was asked "في أي مقاطعة؟" mid-sentence, or told
   * "طلبك مسجّل عندنا ✅" -- the bot talking over the person who had just spoken to them.
   *
   * Silence alone is worse than the interruption, so the first message gets one acknowledgement and
   * the admins are told each time, on their phones, that someone is waiting on them.
   */
  const handover = await getHandover(message.from);

  if (handover.active) {
    await notifyAdmins([
      "👤 *رسالة أثناء محادثة بشرية*",
      "",
      `من: ${message.from.replace("whatsapp:", "")}`,
      message.body.trim() ? `«${message.body.trim().slice(0, 200)}»` : "(مرفق)",
      "",
      "البوت صامت مع هذا الرقم — الرد عليه منك أنت، من صفحة المحادثات."
    ]);

    if (needsAcknowledgement(handover)) {
      await markAcknowledged(message.from);

      return { debugIntent: "intro", reply: await getMessage("handover_ack") };
    }

    // An empty reply is the silence: the webhook sends nothing and logs nothing outbound, while the
    // message they wrote is still stored and still shows in the dashboard.
    return { debugIntent: "intro", reply: "" };
  }

  const storedState = await getConversationState(message.from);

  /**
   * The walkthrough, opened and closed before anything else reads the message.
   *
   * Entry and exit are checked first so neither can be swallowed by a half-filled draft: someone who
   * types "خروج" while three questions into a demo listing means to leave, not to answer.
   */
  const demoAllowed = (await getSettings()).demoEnabled !== "off";

  if (storedState.demo && (isDemoExit(message.body) || hasDemoExpired(storedState.demo))) {
    // The one thing the walkthrough did put anywhere lasting, taken back out.
    if (storedState.demo.videoPath) {
      await deletePropertyMedia(storedState.demo.videoPath);
    }

    await setConversationState(message.from, {
      ...storedState,
      demo: undefined,
      draftProperty: undefined,
      lastSearchResults: undefined,
      selectedProperty: undefined,
      selectedPropertyId: undefined,
      awaitingContactChoice: undefined
    });

    return { debugIntent: "intro", reply: await getMessage("demo_exit") };
  }

  if (demoAllowed && !storedState.demo && isDemoEntry(message.body)) {
    // A fresh slate: a draft or search results left over from real use would leak into the
    // walkthrough and make it teach the wrong thing.
    await setConversationState(message.from, {
      demo: { startedAt: new Date().toISOString() }
    });

    return { debugIntent: "intro", reply: markDemo(await getMessage("demo_start")) };
  }

  /**
   * Wifi requests: a customer applies for the service here and the request lands in the Wifi dashboard.
   * Runs before campaigns so that "apply wifi" is not swallowed by the "wifi" campaign keyword.
   * Does nothing unless WIFI_INTAKE_URL and WIFI_INTAKE_KEY are set.
   */
  if (!storedState.demo) {
    const wifiResult = await handleWifiIntake(message, storedState);

    if (wifiResult) {
      return wifiResult;
    }
  }

  /**
   * The people the flow was never written for.
   *
   * A marketer, a merchant or a partner writes the word from the advert and every path below is
   * wrong for them: the bot asks which district they want and how much they will pay, because those
   * are the only questions it has. A campaign answers that word with the explanation the advert
   * promised -- usually a video -- and leaves whatever they were doing untouched.
   *
   * Not during the walkthrough: someone inside the demo is being shown one thing at a time, and an
   * advert cutting into it teaches the wrong lesson.
   */
  if (!storedState.demo) {
    const campaign = matchCampaign(message.body, await getActiveCampaigns());

    if (campaign) {
      await recordCampaignHit(campaign.id, campaign.hits);

      /**
       * Every file the campaign carries, in the order they were attached.
       *
       * A voice note, a picture and a video are three different kinds of WhatsApp message, and the
       * kind travels with each one: a recording sent as a document arrives as something to download
       * rather than something to press play on.
       */
      const media: Array<{ kind: MediaKind; url: string; label: string; fileName?: string }> = [];

      for (const attachment of campaign.attachments) {
        const link = await signPropertyMedia(attachment.path);

        if (link) {
          media.push({
            kind: attachment.kind,
            url: link,
            label: campaign.name,
            fileName: attachment.name || undefined
          });
        }
      }

      // A campaign whose files cannot be signed still answers with its text: half the message is
      // worth more to someone who just wrote in than silence.
      return {
        debugIntent: "intro",
        reply: campaign.replyText,
        media: media.length > 0 ? media : undefined
      };
    }
  }

  /**
   * Collection mode takes the conversation entirely.
   *
   * Everything the full flow does -- searching, listing, fees, reveals -- assumes there is inventory
   * to trade. Running any of it against an empty database is how the first hundred users are lost,
   * so while the switch is on the bot does one thing: three questions, written down.
   */
  const collectionOn = (await getSettings()).collectionMode === "on";

  if (collectionOn && !storedState.demo) {
    return handleCollection(message, storedState.collect);
  }

  const draftExpired = Boolean(storedState.draftProperty && !isDraftFresh(storedState.draftProperty));

  if (draftExpired) {
    await setConversationState(message.from, { ...storedState, draftProperty: undefined });
  }

  let state = draftExpired ? { ...storedState, draftProperty: undefined } : storedState;
  const contextHint = buildContextHint(state);
  let extracted = (await aiExtractMessage(message.body, [...knownAreas, ...dictionary.areas], contextHint)) ?? extractMessage(message.body, dictionary);
  const fuzzyArea = findAreaCandidate(message.body, activeAreas);
  extracted = normalizeGenericSearchText(extracted);

  // GPT reads some dialect searches ("لاي منزل للايجار") as an owner offering a house, and then the
  // renter is walked through the listing questions. Nobody offers a property without saying so, and
  // the regex fallback gets these right, so a renter phrase with no ownership word wins.
  if (
    extracted.intent === "add_property" &&
    !state.draftProperty &&
    !/عندي|لدي|عندنا|املك|أملك|نأجر|ناجر/.test(message.body) &&
    includesAny(message.body, dictionary.renterSearchPhrases)
  ) {
    extracted = { ...extracted, intent: "search_property" };
  }
  // While a draft is being filled, the message answers the question the bot just asked. Landmarks
  // often carry an area name ("كراج لكصر"), and GPT reads those as a search, which used to abandon
  // the half-filled listing and show search results instead.
  if (
    extracted.intent === "search_property" &&
    state.draftProperty &&
    !state.draftProperty.awaitingConfirmation &&
    !includesAny(message.body, dictionary.renterSearchPhrases)
  ) {
    extracted = { ...extracted, intent: "unknown" };
  }

  if (!extracted.area && fuzzyArea) {
    extracted = {
      ...extracted,
      intent: extracted.intent === "unknown" && !state.draftProperty ? "search_property" : extracted.intent,
      area: fuzzyArea,
      searchText: undefined
    };
  }
  const customReply = findCustomDictionaryReply(message.body, dictionary);
  const normalizedBody = normalizeDictionaryText(message.body);

  // "منزل اخر"، "دار اخرى"، "وريني غيرها" ask for the next results, not for a cheaper price. GPT
  // reads them as a refinement, which used to drop the renter into the max price question.
  // "0" is the shortcut the results list itself advertises, and GPT reads it as picking option zero,
  // which matches nothing and answers "ما لقيت هذا الرقم".
  const asksForMoreResults =
    /^0$/.test(message.body.trim()) ||
    /^(المزيد|مزيد|اكثر|زيد|زد|عرض المزيد|خيارات اخري)$/.test(normalizedBody) ||
    /(^|\s)(اخر|اخري|غيرها|غيره|ثاني|ثانيه)($|\s)/.test(normalizedBody);

  if (asksForMoreResults && (state.lastSearchResults?.length ?? 0) > 0) {
    extracted = { intent: "search_property", searchText: "__more__" };
  }

  // A bare number while results are on screen is the renter picking one. GPT returns "unknown" for
  // it often enough, and the unknown branch then searched the database for "15" as if it were a
  // place name and answered "ما حصلت نتيجة مناسبة لـ 15". Only numbers that actually index the
  // results are taken, so an amount like 2500 keeps its old meaning.
  const bareNumber = message.body.trim().match(/^(\d{1,3})$/);

  // Not when the number is the paging shortcut, which is claimed just above.
  if (bareNumber && !asksForMoreResults && (state.lastSearchResults?.length ?? 0) > 0) {
    extracted = { intent: "select_property", selectedIndex: Number(bareNumber[1]) };
  }

  const referralReply = await applyReferralCode(message.from, message.body);
  if (referralReply) {
    return {
      debugIntent: "intro",
      reply: referralReply
    };
  }

  // Both wordings are accepted. Renaming the balance to أوقية changed what users read, and someone
  // who learned to type نقاطي before that has no way of knowing it stopped working.
  if (/^(رصيدي|نقاطي|أوقيتي|كم رصيدي|كم نقاطي|كم أوقيتي|الرصيد)$/.test(normalizedBody)) {
    return {
      debugIntent: "intro",
      reply: await getWalletReply(message.from)
    };
  }

  if (/^(اجاراتي|ايجاراتي|عقاراتي|دياري|اعلاناتي|املاكي|عقاري)$/.test(normalizedBody)) {
    return {
      debugIntent: "intro",
      reply: await getOwnerListingsReply(message.from)
    };
  }

  const rentedCommand = normalizedBody.match(/^(?:تم تاجير|تم تأجير|تاجرت|اجرت|تم كراء|تم الكراء)\s*(.*)$/);

  if (rentedCommand) {
    return {
      debugIntent: "intro",
      reply: await markListingRented(message.from, rentedCommand[1] ?? "")
    };
  }

  if (/^(تفاصيل احالاتي|تفاصيل الاحالات|تفاصيل دعواتي|قائمة احالاتي)$/.test(normalizedBody)) {
    return {
      debugIntent: "intro",
      reply: await getReferralDetails(message.from)
    };
  }

  if (
    /^(احالاتي|متابعة احالاتي|من سجل عن طريقي|رابط دعوتي|كود دعوتي|دعوتي|رابط الاحالة|كود الاحالة|الاحالة)$/.test(
      normalizedBody
    )
  ) {
    const referral = await getReferralSummary(message.from);

    return {
      debugIntent: "intro",
      reply: referral.summary,
      followUps: [referral.share]
    };
  }

  if (/^(طلب سحب|اسحب|سحب نقاط|سحب أوقية|سحب العمولة)$/.test(normalizedBody)) {
    return {
      debugIntent: "intro",
      reply: await createWithdrawalRequest(message.from)
    };
  }

  if (customReply && (customReply.category === "greeting" || customReply.category === "intro" || !state.draftProperty)) {
    return {
      debugIntent: extracted.intent,
      reply: customReply.responseText
    };
  }

  if (state.awaitingMaxPriceFilter && !message.body.trim().match(/\d{2,8}/)) {
    // The renter answered with something other than a price. Repeating the question trapped them in
    // a loop, so drop it and let the message be handled on its own terms.
    state = { ...state, awaitingMaxPriceFilter: false };
    await setConversationState(message.from, state);
  }

  if (state.awaitingMaxPriceFilter) {
    const maxPrice = message.body.trim().match(/\d{2,8}/)!;

    const allResults = state.lastSearchResults ?? [];
    const refinedResults = refineSearchResults(allResults, {
      intent: "refine_search",
      maxPrice: Number(maxPrice[0])
    });
    const visibleResults = refinedResults.slice(0, 5);

    if (visibleResults.length === 0) {
      await setConversationState(message.from, {
        ...state,
        awaitingMaxPriceFilter: false
      });

      return {
        debugIntent: "search_property",
        reply: `ما لقيت نتيجة أقل من ${formatPrice(Number(maxPrice[0]))} داخل آخر بحث.\n\nجرّب مبلغًا أعلى أو اكتب منطقة جديدة.`
      };
    }

    await setConversationState(message.from, {
      ...state,
      awaitingMaxPriceFilter: false,
      lastSearchResults: refinedResults,
      lastSearchShownCount: visibleResults.length,
      lastSearchQuery: {
        ...(state.lastSearchQuery ?? { intent: "search_property" }),
        maxPrice: Number(maxPrice[0])
      },
      selectedPropertyId: undefined,
      selectedProperty: undefined,
      selectedPropertyAt: undefined,
      awaitingContactChoice: undefined,
      selectedPropertyVideoViewed: undefined,
      activeContactRequestId: undefined
    });

    return {
      debugIntent: "search_property",
      reply: formatSearchResults(visibleResults, state.lastSearchQuery ?? { intent: "search_property" }, {
        total: refinedResults.length,
        hasMore: refinedResults.length > visibleResults.length
      })
    };
  }

  if (extracted.intent === "unknown" && isCasualReply(message.body)) {
    return {
      debugIntent: "intro",
      reply: "تمام، أنا معك. اكتب المنطقة أو المعلم اللي تحب نبحث حوله، أو اكتب: عندي دار للإيجار."
    };
  }

  if (extracted.intent === "search_property" && extracted.searchText === "__more__") {
    const allResults = state.lastSearchResults ?? [];
    const shownCount = state.lastSearchShownCount ?? 0;
    const nextResults = allResults.slice(shownCount, shownCount + 5);

    if (nextResults.length === 0) {
      return {
        debugIntent: "search_property",
        reply: "ما عندي خيارات أكثر حاليًا لنفس البحث. جرّب منطقة أو سعر مختلف."
      };
    }

    // A new page of results replaces whatever was picked before. Leaving the old selection behind
    // made "1" and "2" mean video and contact for the previous house instead of picking from the
    // list now on screen.
    await setConversationState(message.from, {
      ...state,
      lastSearchShownCount: shownCount + nextResults.length,
      selectedPropertyId: undefined,
      selectedProperty: undefined,
      selectedPropertyAt: undefined,
      awaitingContactChoice: undefined,
      selectedPropertyVideoViewed: undefined,
      activeContactRequestId: undefined
    });

    return {
      debugIntent: "search_property",
      reply: formatSearchResults(nextResults, state.lastSearchQuery ?? { intent: "search_property" }, {
        startIndex: shownCount,
        total: allResults.length,
        hasMore: shownCount + nextResults.length < allResults.length
      })
    };
  }

  if (extracted.intent === "refine_search" && !state.draftProperty) {
    const allResults = state.lastSearchResults ?? [];

    if (allResults.length === 0) {
      const example = await getSearchExample();

      return {
        debugIntent: "search_property",
        reply: await getMessage("refine_without_search", { area: example.area, price: example.maxPrice })
      };
    }

    if (!extracted.maxPrice && !extracted.rooms && !extracted.sortBy) {
      await setConversationState(message.from, {
        ...state,
        awaitingMaxPriceFilter: true
      });

      const example = await getSearchExample();

      return {
        debugIntent: "search_property",
        reply: [
          "تحب نضيّق البحث كيف؟",
          "",
          `💰 سعر أقصى — اكتب الرقم، مثلا: *${example.maxPrice}*`,
          "🛏 عدد الغرف — اكتب: *غرفتين*",
          "↕️ الترتيب — اكتب: *أرخص* أو *أغلى*",
          "🏠 دار غير هذه — اكتب: *اخرى*",
          `📍 منطقة ثانية — اكتب اسمها، مثلا: *${example.area}*`
        ].join("\n")
      };
    }

    const refinedResults = refineSearchResults(allResults, extracted);
    const visibleResults = refinedResults.slice(0, 5);

    if (visibleResults.length === 0) {
      return {
        debugIntent: "search_property",
        reply: "ما لقيت نتيجة بهذه المواصفات داخل آخر بحث.\n\nجرّب فلتر أوسع، مثلا: أرخص، أو اكتب: أقل من ثم حدد السعر."
      };
    }

    await setConversationState(message.from, {
      ...state,
      lastSearchResults: refinedResults,
      lastSearchShownCount: visibleResults.length,
      lastSearchQuery: {
        ...(state.lastSearchQuery ?? { intent: "search_property" }),
        maxPrice: extracted.maxPrice ?? state.lastSearchQuery?.maxPrice,
        rooms: extracted.rooms ?? state.lastSearchQuery?.rooms
      },
      selectedPropertyId: undefined,
      selectedProperty: undefined,
      selectedPropertyAt: undefined,
      awaitingContactChoice: undefined,
      selectedPropertyVideoViewed: undefined,
      activeContactRequestId: undefined
    });

    return {
      debugIntent: "search_property",
      reply: formatSearchResults(visibleResults, state.lastSearchQuery ?? { intent: "search_property" }, {
        total: refinedResults.length,
        hasMore: refinedResults.length > visibleResults.length
      })
    };
  }

  if (state.pendingSearch && extracted.intent === "unknown" && !state.draftProperty) {
    const areaFromText = findAreaCandidate(message.body, activeAreas);
    const mergedSearch = {
      ...state.pendingSearch,
      area: state.pendingSearch.area ?? areaFromText
    };

    if (mergedSearch.area) {
      const results = (state.demo ? searchDemoListing(state.demo, mergedSearch) : await searchActiveProperties(mergedSearch));
      const visibleResults = results.slice(0, 5);

      await setConversationState(message.from, {
        ...state,
        pendingSearch: undefined,
        lastSearchResults: results,
        lastSearchShownCount: visibleResults.length,
        lastSearchQuery: mergedSearch,
        selectedPropertyId: undefined,
        selectedProperty: undefined,
        selectedPropertyAt: undefined,
        awaitingContactChoice: undefined,
        selectedPropertyVideoViewed: undefined,
        activeContactRequestId: undefined
      });

      if (results.length === 0) {
        return {
          debugIntent: "search_property",
        reply: await buildNoResults(mergedSearch.area)
        };
      }

      return {
        debugIntent: "search_property",
        reply: formatSearchResults(visibleResults, mergedSearch, {
          total: results.length,
          hasMore: results.length > visibleResults.length
        })
      };
    }
  }

  if (state.lastSearchQuery && extracted.intent === "unknown" && !state.draftProperty && message.media.length === 0) {
    const areaFromText = findAreaCandidate(message.body, activeAreas);
    const text = message.body.trim();
    const refinedSearch = {
      ...state.lastSearchQuery,
      area: areaFromText,
      searchText: areaFromText ? state.lastSearchQuery.searchText : text
    };
    const results = (state.demo ? searchDemoListing(state.demo, refinedSearch) : await searchActiveProperties(refinedSearch));
    const visibleResults = results.slice(0, 5);

    await setConversationState(message.from, {
      ...state,
      pendingSearch: undefined,
      lastSearchResults: results,
      lastSearchShownCount: visibleResults.length,
      lastSearchQuery: refinedSearch,
      selectedPropertyId: undefined,
      selectedProperty: undefined,
      selectedPropertyAt: undefined,
      awaitingContactChoice: undefined,
      selectedPropertyVideoViewed: undefined,
      activeContactRequestId: undefined
    });

    if (results.length === 0) {
      return {
        debugIntent: "search_property",
        reply: await buildNoResults(areaFromText ?? text)
      };
    }

    return {
      debugIntent: "search_property",
      reply: formatSearchResults(visibleResults, refinedSearch, {
        total: results.length,
        hasMore: results.length > visibleResults.length
      })
    };
  }

  if (state.draftProperty && /^(الغاء|إلغاء|احذف|حذف)$/i.test(message.body.trim())) {
    await setConversationState(message.from, {
      ...state,
      draftProperty: undefined
    });

    return {
      debugIntent: "add_property",
      reply: "تم إلغاء مسودة الإعلان. يمكنك البدء من جديد بكتابة: عندي شقة للإيجار."
    };
  }

  if (state.draftProperty?.awaitingConfirmation) {
    if (isYes(message.body) && state.demo) {
      /**
       * The whole reason this feature is safe: the listing stops here.
       *
       * It goes into the conversation, not the properties table, so it can never appear in a real
       * search and no renter can ever pay to reveal a number for a house that does not exist.
       */
      await setConversationState(message.from, {
        ...state,
        draftProperty: undefined,
        demo: { ...state.demo, listing: demoListingFrom(state.draftProperty, message.from) }
      });

      return { debugIntent: "add_property", reply: markDemo(await getMessage("demo_published")) };
    }

    if (isYes(message.body)) {
      // Submitting is free. The fee is taken when an admin publishes, so nothing is charged for a
      // listing that ends up rejected.
      const submission = await submitPropertyForReview(message.from, state.draftProperty);
      const balance = await getUsagePoints(message.from);
      const { listingFeePoints: propertyListingFeePoints } = await getSettings();

      await setConversationState(message.from, {
        ...state,
        draftProperty: undefined
      });

      if (!submission.saved) {
        return {
          debugIntent: "add_property",
          reply: "✅ تم تأكيد الإعلان في المحاكي. عند ربط Supabase سيتم حفظه تلقائيًا وإرساله للإدارة للمراجعة."
        };
      }

      // Too little to publish: send the same top-up card a renter gets, so the owner has the
      // payment number and the steps rather than just being told to top up.
      if (balance !== null && balance < propertyListingFeePoints) {
        return {
          debugIntent: "add_property",
          reply: [
            "✅ تم إرسال الإعلان إلى الإدارة للمراجعة.",
            "",
            await getPointsTopupInstructions({
              currentBalance: balance,
              purposeText: `🔐 نشر إعلان العقار يحتاج *${propertyListingFeePoints} أوقية*.`
            })
          ].join("\n")
        };
      }

      return {
        debugIntent: "add_property",
        reply: [
          "✅ تم إرسال الإعلان إلى الإدارة للمراجعة.",
          "",
          `🔐 عند الموافقة على النشر تُخصم *${propertyListingFeePoints} أوقية* من رصيدك.`,
          ...(balance === null ? [] : [`💼 رصيدك الآن: *${balance} أوقية*`]),
          "",
          "سنخبرك عند الموافقة أو إذا احتاج الإعلان لتعديل.",
          "",
          // Right after a successful action is when someone is most willing to recommend the bot.
          "🎁 ادعُ مؤجرين آخرين واكسب رصيدًا مجانيًا — اكتب: *إحالاتي*"
        ].join("\n")
      };
    }

    if (isNo(message.body)) {
      await setConversationState(message.from, {
        ...state,
        draftProperty: touchDraft({
          ...state.draftProperty,
          awaitingConfirmation: false
        })
      });

      const example = await getSearchExample();

      return {
        debugIntent: "add_property",
        reply: `تمام. اكتب الشيء الذي تريد تعديله مثل: السعر ${example.maxPrice}، المقاطعة ${example.area}، المعلم قرب السوق. أو اكتب إلغاء لحذف المسودة.`
      };
    }
  }

  /**
   * Answered before anything else touches the media.
   *
   * A voice note carries no text, so it used to fall through every branch and land on the generic
   * welcome: someone spoke for a minute and was answered as though they had said nothing, with no
   * hint that they had not been heard. Placed above the video and receipt branches so it cannot be
   * mistaken for either.
   */
  if (message.media.some((item) => item.contentType.startsWith("audio/"))) {
    return {
      debugIntent: "unknown",
      reply: await getMessage("voice_not_supported")
    };
  }

  const incomingVideo = message.media.find((item) => item.contentType.startsWith("video/"));
  if (incomingVideo) {
    // Copy it now: the WhatsApp link expires long before the owner confirms the listing.
    const { path: storedPath, error: videoError } = await storePropertyVideo(
      incomingVideo.url,
      incomingVideo.contentType,
      message.from
    );

    /**
     * Refused here rather than accepted and discovered later.
     *
     * A video WhatsApp will not relay -- an H.265 export, a copy that stopped partway -- is taken by
     * Meta, acknowledged with a media id, and then silently not delivered. The listing looks complete
     * and shows a renter nothing, which is a fault nobody reports because the renter simply leaves.
     */
    if (videoError) {
      // The reason is a codec name, and the owner is a landlord with a phone. They are told what to
      // do; the sentence that says why is kept for the logs, where someone can act on it.
      console.error(`Rejected a listing video from ${message.from}: ${videoError}`);

      return {
        debugIntent: "add_property",
        reply: await getMessage("video_rejected")
      };
    }

    if (state.demo && storedPath) {
      // Kept on the walkthrough rather than the listing, so it can be deleted when it closes.
      state = { ...state, demo: { ...state.demo, videoPath: storedPath } };
    }

    const draftProperty = touchDraft({
      ...state.draftProperty,
      hasVideo: true,
      // Only reached with no database at all, where nothing is being saved anyway.
      videoUrl: storedPath ?? incomingVideo.url,
      videoContentType: incomingVideo.contentType,
      awaitingConfirmation: Boolean(
        state.draftProperty?.area &&
          state.draftProperty?.price &&
          state.draftProperty?.landmark &&
          state.draftProperty?.rooms &&
          state.draftProperty?.commission !== undefined
      )
    });
    await setConversationState(message.from, {
      ...state,
      draftProperty
    });

    return {
      debugIntent: "add_property",
      reply: await getNextPropertyQuestion(draftProperty)
    };
  }

  if (message.location) {
    const draftProperty = touchDraft({
      ...state.draftProperty,
      hasLocation: true
    });
    await setConversationState(message.from, {
      ...state,
      draftProperty
    });

    return {
      debugIntent: "add_property",
      reply: "تم استلام الموقع كمعلومة إضافية. الموقع ليس شرطًا للنشر، والأهم هو المعلم القريب والفيديو."
    };
  }

  if (message.media.length > 0) {
    // Every receipt image is a points top-up now. Access to an owner number is paid from the balance,
    // so a receipt must never be attached to a contact request or send it back for admin review.
    const receipt = message.media.find((item) => item.contentType.startsWith("image/"));

    if (receipt) {
      // Copied into our own storage like a listing video is. The link WhatsApp hands over expires
      // within minutes and needs a bearer token, so storing it as-is left admins with a receipt
      // they could never open. Falls back to the original link if the copy fails, which is no worse
      // than what was stored before.
      const storedPath = await storePropertyMedia(receipt.url, receipt.contentType, message.from);

      return {
        debugIntent: "send_payment_receipt",
        reply: await createCreditTopupRequest(message.from, storedPath ?? receipt.url)
      };
    }

    return {
      debugIntent: extracted.intent,
      reply: "تم استلام الملف. إذا كان إيصال دفع فسيتم مراجعته من الإدارة، وإذا كان صورة للعقار فسيتم حفظها مع الإعلان."
    };
  }

  const trimmedBody = message.body.trim();
  const draftAwaitsPrice = Boolean(state.draftProperty?.area && !state.draftProperty?.price);
  const draftAwaitsRooms = Boolean(
    state.draftProperty?.area &&
      state.draftProperty?.price &&
      state.draftProperty?.landmark &&
      !state.draftProperty?.rooms
  );
  const draftAwaitsCommission =
    Boolean(
      state.draftProperty?.area &&
        state.draftProperty?.price &&
        state.draftProperty?.landmark &&
        state.draftProperty?.rooms
    ) && state.draftProperty?.commission === undefined;
  // A bare number that indexes the last search results is the renter picking a property. It must win
  // over an unfinished listing draft parked in the same conversation, since one phone can be both a
  // renter and an owner. While a draft is open the message has to be nothing but that number: GPT
  // pulls an index out of any sentence with a number word in it, and "بانتيك عشرة" as an answer to
  // the landmark question was selecting the tenth result of a search from an earlier session.
  const selectsFromLastResults =
    extracted.intent === "select_property" &&
    (!state.draftProperty || /^\d+$/.test(trimmedBody)) &&
    !(draftAwaitsPrice && /^\d{2,8}$/.test(trimmedBody)) &&
    // "3" answering the room count is not the third result of a search from an earlier session.
    !(draftAwaitsRooms && /^\d{1,2}$/.test(trimmedBody)) &&
    // Nor is one answering the commission, which may legitimately be any amount at all.
    !(draftAwaitsCommission && /^\d{1,8}$/.test(trimmedBody)) &&
    Boolean(extracted.selectedIndex && state.lastSearchResults?.[extracted.selectedIndex - 1]);

  if (
    state.draftProperty &&
    !selectsFromLastResults &&
    (extracted.intent === "unknown" || extracted.intent === "select_property" || extracted.intent === "refine_search")
  ) {
    const draftProperty = mergeDraftFromMessage(state.draftProperty, extracted, message.body, activeAreas);

    // "كراج لكصر" as a landmark must not move a listing that is already in another district. The
    // area is only still open to change once the landmark has been given, which is the edit flow.
    if (!state.draftProperty.landmark && state.draftProperty.area) {
      draftProperty.area = state.draftProperty.area;
    }

    if (!draftProperty.landmark && state.draftProperty.area && state.draftProperty.price) {
      draftProperty.landmark = message.body.trim();
    }

    draftProperty.awaitingConfirmation = Boolean(
      draftProperty.area &&
        draftProperty.price &&
        draftProperty.landmark &&
        draftProperty.rooms &&
        draftProperty.commission !== undefined &&
        draftProperty.hasVideo
    );

    await setConversationState(message.from, {
      ...state,
      draftProperty: touchDraft(draftProperty)
    });

    return {
      debugIntent: "add_property",
      reply: await getNextPropertyQuestion(draftProperty)
    };
  }

  if (state.awaitingContactChoice && message.body.trim() === "1") {
    /**
     * The last step of the walkthrough: the card a renter gets after paying, and no payment.
     *
     * The video gate is skipped too. It exists to stop a renter buying a number for a house they
     * have not looked at, and here the house is their own -- being asked to watch a video they
     * recorded a minute ago teaches nothing and stalls the demo.
     */
    if (state.demo?.listing && state.selectedProperty) {
      const card = await formatOwnerContact(state.demo.listing);

      await setConversationState(message.from, {
        ...state,
        demo: { ...state.demo, finished: true },
        awaitingContactChoice: false
      });

      return {
        debugIntent: "request_contact",
        reply: markDemo(card),
        followUps: [await getMessage("demo_revealed")]
      };
    }

    if (!state.selectedPropertyId || !state.selectedProperty || !hasFreshSelection(state)) {
      return {
        debugIntent: "request_contact",
        reply: "اختر دارًا من آخر النتائج أولًا. اكتب رقم الخيار مثل: 1"
      };
    }

    if (!state.selectedPropertyVideoViewed) {
      return {
        debugIntent: "select_property",
        reply: "قبل طلب الرقم، شوف فيديو الدار حتى تتأكد أنها مناسبة لك.\n\nاكتب: 2 لمشاهدة الفيديو."
      };
    }

    const request = await spendPointForContact(message.from, state.selectedProperty);

    if (!request.ok) {
      if (request.reason === "insufficient_points") {
        await setConversationState(message.from, {
          ...state,
          pendingContactProperty: state.selectedProperty
        });
      }

      return {
        debugIntent: "request_contact",
        reply: request.reply
      };
    }

    await setConversationState(message.from, {
      ...state,
      awaitingContactChoice: false,
      activeContactRequestId: request.id,
      pendingContactProperty: undefined
    });

    return {
      debugIntent: "request_contact",
      reply: request.reply
    };
  }

  if (state.awaitingContactChoice && message.body.trim() === "2") {
    if (!state.selectedPropertyId || !state.selectedProperty || !hasFreshSelection(state)) {
      return {
        debugIntent: "select_property",
        reply: "اختر دارًا من آخر النتائج أولًا. اكتب رقم الخيار مثل: 1"
      };
    }

    const videoUrl = state.demo
      ? state.demo.videoPath
        ? ((await signPropertyMedia(state.demo.videoPath)) ?? undefined)
        : undefined
      : await getPropertyVideoUrl(state.selectedProperty.id);

    await setConversationState(message.from, {
      ...state,
      selectedPropertyVideoViewed: true
    });

    if (!videoUrl) {
      /**
       * Inside the walkthrough this must not read as a broken listing.
       *
       * A marketer who sees "الفيديو غير متوفر" learns that videos do not show, and will
       * say so to a landlord. The step is explained instead, which is true whether or not the file
       * made it into storage.
       */
      return {
        debugIntent: "select_property",
        reply: state.demo
          ? await getMessage("demo_video_step")
          : "الفيديو غير متوفر لهذا الإعلان حاليًا. جرّب اختيار دار ثانية أو اكتب بحث جديد."
      };
    }

    return {
      debugIntent: "select_property",
      // The digit sits inside the sentence rather than after a colon at the end: a line ending on a
      // lone Latin numeral is the part that wrapped away from its own instruction.
      reply: "هذا فيديو الدار.\n\nإذا أعجبتك، اكتب *1* لطلب رقم المؤجر.",
      video: { url: videoUrl }
    };
  }

  switch (extracted.intent) {
    case "greeting":
      return {
        debugIntent: "greeting",
        // The salutation answers whatever was typed, so "صباح الخير" is not met with "وعليكم السلام".
        reply: await getMessage("greeting", { salutation: salutationFor(message.body) })
      };

    case "intro":
      return {
        debugIntent: "intro",
        reply: await getMessage("intro")
      };

    case "add_property": {
      const draftProperty = mergeDraftFromMessage(state.draftProperty ?? {}, extracted, message.body, activeAreas);
      draftProperty.awaitingConfirmation = Boolean(
        draftProperty.area &&
          draftProperty.price &&
          draftProperty.landmark &&
          draftProperty.rooms &&
          draftProperty.commission !== undefined &&
          draftProperty.hasVideo
      );

      await setConversationState(message.from, {
        ...state,
        draftProperty: touchDraft(draftProperty)
      });

      return {
        debugIntent: "add_property",
        reply: await getNextPropertyQuestion(draftProperty)
      };
    }

    case "search_property":
      {
        if (!extracted.area && !extracted.searchText) {
          await setConversationState(message.from, {
            ...state,
            pendingSearch: extracted,
            lastSearchResults: undefined,
            lastSearchShownCount: undefined,
            lastSearchQuery: undefined,
            selectedPropertyId: undefined,
            selectedProperty: undefined,
            selectedPropertyAt: undefined,
            awaitingContactChoice: undefined,
            selectedPropertyVideoViewed: undefined,
            activeContactRequestId: undefined
          });

          return {
            debugIntent: "search_property",
            reply: `في أي منطقة تبحث عن ${extracted.propertyType ?? "عقار"}؟\n\nمثال: عرفات، تفرغ زينة، لكصر.`
          };
        }

        const results = (state.demo ? searchDemoListing(state.demo, extracted) : await searchActiveProperties(extracted));

        const visibleResults = results.slice(0, 5);

        await setConversationState(message.from, {
          ...state,
          pendingSearch: undefined,
          lastSearchResults: results,
          lastSearchShownCount: visibleResults.length,
          lastSearchQuery: extracted,
          selectedPropertyId: undefined,
          selectedProperty: undefined,
          selectedPropertyAt: undefined,
          awaitingContactChoice: undefined,
          selectedPropertyVideoViewed: undefined,
          activeContactRequestId: undefined
        });

        if (results.length === 0) {
          return {
            debugIntent: "search_property",
            reply: await buildNoResults(extracted.area ?? extracted.searchText)
          };
        }

        return {
          debugIntent: "search_property",
          reply: formatSearchResults(visibleResults, extracted, {
            total: results.length,
            hasMore: results.length > visibleResults.length
          })
        };
      }

    case "select_property":
      {
        const selected = extracted.selectedIndex ? state.lastSearchResults?.[extracted.selectedIndex - 1] : undefined;

        if (!selected) {
          const available = state.lastSearchResults?.length ?? 0;

          return {
            debugIntent: "select_property",
            reply: available
              ? `ما لقيت الرقم *${extracted.selectedIndex ?? message.body.trim()}* في آخر النتائج.\n\nالأرقام المتاحة من *1* إلى *${available}*، أو أرسل بحثًا جديدًا.`
              : "ما عندي نتائج بحث حاليًا.\n\nاكتب المنطقة التي تبحث فيها، مثلا: عرفات."
          };
        }

        await setConversationState(message.from, {
          ...state,
          selectedPropertyId: selected.id,
          selectedProperty: selected,
          selectedPropertyAt: new Date().toISOString(),
          awaitingContactChoice: true,
          selectedPropertyVideoViewed: false,
          activeContactRequestId: undefined
        });

        return {
          debugIntent: "select_property",
          reply: [
            "╭──────────────",
            `🏠 *دار في ${selected.area}*`,
            "╰──────────────",
            "",
            "💰 السعر",
            `*${formatPrice(selected.price)}*`,
            "",
            "🛏 الغرف",
            `${selected.rooms ?? "غير محدد"}`,
            ...(selected.extras ? ["", "✨ إضافات", selected.extras] : []),
            "",
            "📍 قريبة من",
            formatLandmark(selected.landmark),
            "",
            "━━━━━━━━━━━━━━",
            "🎥 *الخطوة التالية*",
            "اكتب *2* لمشاهدة فيديو الدار.",
            "بعد الفيديو، إذا عجبتك الدار اكتب *1* لطلب رقم المؤجر."
          ].join("\n")
        };
      }

    case "request_contact":
      if (!state.selectedPropertyId || !state.selectedProperty || !hasFreshSelection(state)) {
        return {
          debugIntent: "request_contact",
          reply: "اختر دارًا أولًا من آخر نتائج البحث، ثم اطلب التواصل.\n\nمثال: اكتب 1 لاختيار أول دار."
        };
      }

      if (!state.selectedPropertyVideoViewed) {
        return {
          debugIntent: "select_property",
          reply: "قبل طلب الرقم، شوف فيديو الدار حتى تتأكد أنها مناسبة لك.\n\nاكتب: 2 لمشاهدة الفيديو."
        };
      }

      const contactRequest = await spendPointForContact(message.from, state.selectedProperty);

      if (!contactRequest.ok) {
        if (contactRequest.reason === "insufficient_points") {
          await setConversationState(message.from, {
            ...state,
            pendingContactProperty: state.selectedProperty
          });
        }

        return {
          debugIntent: "request_contact",
          reply: contactRequest.reply
        };
      }

      await setConversationState(message.from, {
        ...state,
        awaitingContactChoice: false,
        activeContactRequestId: contactRequest.id,
        pendingContactProperty: undefined
      });

      return {
        debugIntent: "request_contact",
        reply: contactRequest.reply
      };

    case "send_payment_receipt":
      return {
        debugIntent: "send_payment_receipt",
        reply: await getPointsTopupInstructions()
      };

    default: {
      const example = await getSearchExample();

      return {
        debugIntent: "unknown",
        reply: `أهلًا بك. يمكنك إرسال طلب مثل: لدي شقة للإيجار، أو: أريد شقة في ${example.area} بحد أقصى ${example.maxPrice}. الحقول الأساسية للعقار: ${requiredPropertyFields.join("، ")}.`
      };
    }
  }
}

