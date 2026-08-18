import type { IncomingWhatsAppMessage } from "@/lib/whatsapp/types";
import { getServiceSupabase } from "@/lib/supabase/server";
import { extractMessage } from "./extract";
import { aiExtractMessage } from "./ai-extract";
import { getRuntimeDictionary } from "./local-dictionary";
import { mockProperties } from "./mock-data";
import { getConversationState, setConversationState } from "./store";
import { storePropertyMedia } from "@/lib/whatsapp/media";
import type { ConversationResult, DraftProperty, ExtractedMessage, PropertyCandidate } from "./types";

const requiredPropertyFields = ["السعر", "المنطقة", "معلم مشهور قريب", "فيديو للعقار"];
const knownAreas = ["تفرغ زينة", "عرفات", "لكصر", "تيارت", "دار النعيم", "السبخة", "الميناء"];
const selectionTtlMs = 15 * 60 * 1000;
const draftTtlMs = 60 * 60 * 1000;
const minimumWithdrawalPoints = 500;
const propertyListingFeePoints = 2000;

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

function formatPropertySummary(draft: DraftProperty) {
  return [
    "راجع ملخص الإعلان قبل إرساله للإدارة:",
    "",
    `النوع: ${draft.type ?? "غير محدد"}`,
    `المقاطعة: ${draft.area}`,
    `السعر: ${draft.price}`,
    `المعلم القريب: ${draft.landmark}`,
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
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(price)} جديدة`;
}

function formatLandmark(landmark: string) {
  return landmark.replace(/^(قرب|قريبة من|بالقرب من)\s+/i, "").trim();
}

function normalizePhoneDigits(phone: string) {
  return phone.replace(/\D/g, "");
}

function makeReferralCode(phone: string) {
  const digits = normalizePhoneDigits(phone);
  const suffix = digits.slice(-4).padStart(4, "0");
  return `${digits}-${suffix}`;
}

function makeReferralLink(referralCode: string) {
  const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? process.env.ADMIN_WHATSAPP_NUMBERS?.split(",")[0]?.replace("whatsapp:", "");
  const text = encodeURIComponent(`ابدأ ${referralCode}`);
  return whatsappNumber ? `https://wa.me/${normalizePhoneDigits(whatsappNumber)}?text=${text}` : `كود دعوتك: ${referralCode}`;
}

function getPointsPaymentNumber() {
  return (
    process.env.POINTS_PAYMENT_NUMBER ??
    process.env.ADMIN_WHATSAPP_NUMBERS?.split(",")[0]?.replace("whatsapp:", "") ??
    ""
  );
}

function getPointsTopupInstructions(options?: { currentBalance?: number; purposeText?: string }) {
  const paymentNumber = getPointsPaymentNumber();
  const currentBalance = options?.currentBalance;

  if (!paymentNumber) {
    return [
      "⚠️ *شحن النقاط غير مفعل حاليًا*",
      "",
      "الإدارة تحتاج تضيف رقم الدفع في إعدادات النظام حتى نقدر نستقبل طلبات الشحن."
    ].join("\n");
  }

  return [
    "╭──────────────",
    "💳 *شحن نقاط الديارة*",
    "╰──────────────",
    "",
    ...(currentBalance !== undefined ? [`💼 رصيدك الحالي: *${currentBalance} نقطة*`, ""] : []),
    options?.purposeText ?? "🔐 عرض رقم المؤجر يحتاج *1 نقطة*.",
    "",
    "1️⃣ حوّل مبلغ الشحن إلى هذا الرقم:",
    `*${paymentNumber.replace("whatsapp:", "")}*`,
    "",
    "2️⃣ بعد التحويل أرسل صورة الإيصال هنا.",
    "",
    "3️⃣ بعد موافقة الإدارة تضاف النقاط لرصيدك مباشرة.",
    "",
    "📌 لمتابعة رصيدك اكتب: *رصيدي*"
  ].join("\n");
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
    .map(
      (property, index) =>
        [
          `*${startIndex + index + 1}.* 🏠 دار في ${property.area}`,
          `💰 السعر: *${formatPrice(property.price)}*`,
          `📍 قريبة من: ${formatLandmark(property.landmark)}`
        ].join("\n")
    )
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
      status: "pending_review",
      description: "تم إنشاء الإعلان من محادثة واتساب."
    })
    .select("id")
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

  return { saved: true };
}

function getNextPropertyQuestion(draft: DraftProperty) {
  if (!draft.area) {
    return "في أي مقاطعة يقع العقار؟ مثال: تفرغ زينة، عرفات، لكصر.";
  }

  if (!draft.price) {
    return "كم سعر الإيجار؟ اكتب الرقم فقط أو مع العملة.";
  }

  if (!draft.landmark) {
    return "ما هو أقرب معلم مشهور للعقار؟ مثال: المستشفى الإسباني، كارفور، سوق معروف.";
  }

  if (!draft.hasVideo) {
    return "أرسل فيديو واضح للعقار من فضلك. الفيديو ضروري قبل مراجعة الإدارة.";
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
  const numericAnswer = body.trim().match(/^\d{2,8}$/);

  return {
    ...draft,
    type: extracted.propertyType ?? draft.type,
    area: extracted.area ?? areaFromText ?? draft.area,
    landmark: extracted.landmark ?? draft.landmark,
    price: extracted.price ?? (numericAnswer ? Number(numericAnswer[0]) : undefined) ?? draft.price,
    rooms: extracted.rooms ?? draft.rooms
  };
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

  const selectColumns = "id,property_code,owner_phone,type,area,landmark,price,rooms";
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
    rooms: property.rooms ?? undefined
  }));
}

// The renter may get this long after picking the house, so it repeats which one it is instead of
// sending a bare phone number.
export function formatOwnerContact(selected: PropertyCandidate, note: string[] = []) {
  return [
    "╭──────────────",
    `🏠 *${selected.type ?? "دار"} في ${selected.area}*`,
    "╰──────────────",
    "",
    "💰 السعر",
    `*${formatPrice(selected.price)}*`,
    "",
    "🛏 الغرف",
    `${selected.rooms ?? "غير محدد"}`,
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
    .in("status", ["pending_payment", "pending_admin_review", "approved"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Already paid for: hand the number over again without charging a second point.
  if (existing?.status === "approved") {
    return { saved: true, existing: true, id: existing.id as string, status: existing.status as string };
  }

  // Left over from when contact requests waited for an admin. Access is paid with points now, so
  // approve the row instead of stranding the renter behind a review that no longer happens.
  if (existing) {
    const { error: approveError } = await supabase
      .from("contact_requests")
      .update({ status: "approved" })
      .eq("id", existing.id);

    if (approveError) {
      console.error("Failed to approve a pending contact request", approveError);
      return { saved: false, error: approveError.message };
    }

    return { saved: true, existing: false, id: existing.id as string };
  }

  const { data, error } = await supabase
    .from("contact_requests")
    .insert({
      property_id: selected.id,
      renter_phone: renterPhone,
      owner_phone: selected.ownerPhone,
      status: "approved",
      fee_amount: Number(process.env.CONTACT_REQUEST_FEE ?? "100")
    })
    .select("id")
    .single();

  if (error) {
    console.error("Failed to create contact request", error);
    return { saved: false, error: error.message };
  }

  return { saved: true, existing: false, id: data.id as string };
}

export async function spendPointsForListing(ownerPhone: string) {
  const supabase = getServiceSupabase();

  // Simulator mode: without Supabase there is no wallet to charge, so let the listing through.
  if (!supabase) {
    return {
      ok: true,
      reply: `تم خصم ${propertyListingFeePoints} نقطة (محاكاة فقط، بدون ربط قاعدة البيانات).`
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
      reply: getPointsTopupInstructions({ currentBalance: usagePoints, purposeText: `🔐 نشر إعلان العقار يحتاج *${propertyListingFeePoints} نقطة*.` })
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
      reply: "تعذر خصم النقاط الآن. حاول مرة أخرى بعد قليل."
    };
  }

  await supabase.from("credit_transactions").insert({
    phone: ownerPhone,
    kind: "property_listing",
    usage_points_delta: -propertyListingFeePoints,
    admin_note: "خصم نقاط نشر إعلان عقار"
  });

  return {
    ok: true,
    reply: [
      `تم خصم *${propertyListingFeePoints} نقطة* من رصيدك.`,
      `رصيدك المتبقي: *${usagePoints - propertyListingFeePoints} نقطة*`
    ].join("\n")
  };
}

async function spendPointForContact(renterPhone: string, selected: PropertyCandidate) {
  const supabase = getServiceSupabase();
  const wallet = await ensureWallet(renterPhone);

  if (!supabase || !wallet) {
    return {
      ok: false,
      reply: "تعذر قراءة رصيدك الآن. حاول مرة أخرى بعد قليل."
    };
  }

  const usagePoints = Number(wallet.usage_points ?? 0);

  if (usagePoints <= 0) {
    return {
      ok: false,
      reason: "insufficient_points" as const,
      reply: getPointsTopupInstructions({ currentBalance: usagePoints })
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
      usage_points: usagePoints - 1
    })
    .eq("phone", renterPhone);

  if (walletError) {
    console.error("Failed to spend contact point", walletError);
    return {
      ok: false,
      reply: "تعذر خصم النقطة الآن. حاول مرة أخرى بعد قليل."
    };
  }

  await supabase.from("credit_transactions").insert({
    phone: renterPhone,
    kind: "contact_reveal",
    usage_points_delta: -1,
    related_contact_request_id: request.id,
    admin_note: "خصم نقطة لطلب رقم المؤجر"
  });

  return {
    ok: true,
    id: request.id,
    reply: formatOwnerContact(selected, [
      ...(request.existing ? ["🔁 طلب مكرر لنفس الدار."] : []),
      "تم خصم *1 نقطة* من رصيدك.",
      `رصيدك المتبقي: *${usagePoints - 1} نقطة*`
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

async function ensureWallet(phone: string) {
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
    const expectedCode = makeReferralCode(phone);
    if (!String(existing.referral_code ?? "").includes("-")) {
      const { data: updated } = await supabase
        .from("user_wallets")
        .update({
          referral_code: expectedCode
        })
        .eq("phone", phone)
        .select("*")
        .single();

      return updated ?? existing;
    }

    return existing;
  }

  const { data, error } = await supabase
    .from("user_wallets")
    .insert({
      phone,
      referral_code: makeReferralCode(phone)
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

  const referralCode = body.match(/\b\d{8,15}-\d{4}\b/)?.[0];

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
      referred_by_phone: referrer.phone
    })
    .eq("phone", phone);

  if (updateError) {
    console.error("Failed to apply referral code", updateError);
    return "تعذر تسجيل كود الدعوة الآن. حاول مرة أخرى بعد قليل.";
  }

  return [
    "✅ تم تسجيل كود الدعوة بنجاح.",
    "",
    "عند أول شحن نقاط تتم الموافقة عليه، سيحصل صاحب الدعوة على *30%* نقاط تسويق."
  ].join("\n");
}

async function getWalletReply(phone: string) {
  const wallet = await ensureWallet(phone);

  if (!wallet) {
    return "تعذر تحميل رصيدك الآن. حاول مرة أخرى بعد قليل.";
  }

  const usagePoints = Number(wallet.usage_points ?? 0);
  const commissionPoints = Number(wallet.commission_points ?? 0);
  const remaining = Math.max(minimumWithdrawalPoints - commissionPoints, 0);
  const referralCode = String(wallet.referral_code ?? makeReferralCode(phone));

  return [
    "╭──────────────",
    "💼 *محفظتك في الديارة*",
    "╰──────────────",
    "",
    "🏠 نقاط الاستخدام",
    `*${usagePoints} نقطة*`,
    "",
    "📣 نقاط التسويق",
    `*${commissionPoints} نقطة*`,
    "",
    "━━━━━━━━━━━━━━",
    "💸 السحب",
    `الحد الأدنى: *${minimumWithdrawalPoints} نقطة*`,
    remaining > 0 ? `المتبقي: *${remaining} نقطة*` : "يمكنك طلب السحب الآن. اكتب: *طلب سحب*",
    "",
    "━━━━━━━━━━━━━━",
    "🔗 رابط دعوتك",
    makeReferralLink(referralCode)
  ].join("\n");
}

async function createWithdrawalRequest(phone: string) {
  const supabase = getServiceSupabase();
  const wallet = await ensureWallet(phone);

  if (!supabase || !wallet) {
    return "تعذر إنشاء طلب السحب الآن. حاول مرة أخرى بعد قليل.";
  }

  const commissionPoints = Number(wallet.commission_points ?? 0);

  if (commissionPoints < minimumWithdrawalPoints) {
    return [
      `رصيد التسويق عندك: *${commissionPoints} نقطة*`,
      `الحد الأدنى للسحب: *${minimumWithdrawalPoints} نقطة*`,
      "",
      `باقي لك *${minimumWithdrawalPoints - commissionPoints} نقطة* حتى تقدر تطلب السحب.`
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

  return [
    "تم استلام طلب السحب.",
    "",
    `النقاط المطلوبة للسحب: *${commissionPoints} نقطة*`,
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

  return [
    "✅ تم استلام إيصال شحن النقاط.",
    "",
    "سيتم مراجعته من الإدارة، وبعد الموافقة تضاف النقاط إلى رصيدك.",
    "يمكنك كتابة *رصيدي* في أي وقت لمتابعة نقاطك."
  ].join("\n");
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

  return data?.storage_url as string | undefined;
}

function buildContextHint(state: Awaited<ReturnType<typeof getConversationState>>) {
  if (state.draftProperty && !state.draftProperty.awaitingConfirmation) {
    const draft = state.draftProperty;

    if (!draft.area) {
      return "البوت سأل المستخدم للتو عن منطقة عقاره الذي يريد عرضه للإيجار (يملكه). اعتبر أي رد نصي بسيط (اسم منطقة) استكمالاً لإضافة العقار (add_property)، وليس بحثاً جديداً.";
    }

    if (!draft.price) {
      return "البوت سأل المستخدم للتو عن سعر إيجار العقار الذي يعرضه (يملكه). اعتبر أي رقم أو رد نصي استكمالاً لإضافة العقار (add_property).";
    }

    if (!draft.landmark) {
      return "البوت سأل المستخدم للتو عن أقرب معلم لعقاره الذي يعرضه (يملكه). اعتبر أي رد نصي استكمالاً لإضافة العقار (add_property)، وليس بحثاً جديداً أو منطقة بحث.";
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

export async function handleIncomingMessage(message: IncomingWhatsAppMessage): Promise<ConversationResult> {
  const dictionary = await getRuntimeDictionary();
  const activeAreas = [...knownAreas, ...dictionary.areas];
  const storedState = await getConversationState(message.from);
  const draftExpired = Boolean(storedState.draftProperty && !isDraftFresh(storedState.draftProperty));

  if (draftExpired) {
    await setConversationState(message.from, { ...storedState, draftProperty: undefined });
  }

  let state = draftExpired ? { ...storedState, draftProperty: undefined } : storedState;
  const contextHint = buildContextHint(state);
  let extracted = (await aiExtractMessage(message.body, [...knownAreas, ...dictionary.areas], contextHint)) ?? extractMessage(message.body, dictionary);
  const fuzzyArea = findAreaCandidate(message.body, activeAreas);
  extracted = normalizeGenericSearchText(extracted);
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
  if (
    /(^|\s)(اخر|اخري|غيرها|غيره|ثاني|ثانيه)($|\s)/.test(normalizedBody) &&
    (state.lastSearchResults?.length ?? 0) > 0
  ) {
    extracted = { intent: "search_property", searchText: "__more__" };
  }

  const referralReply = await applyReferralCode(message.from, message.body);
  if (referralReply) {
    return {
      debugIntent: "intro",
      reply: referralReply
    };
  }

  if (/^(رصيدي|نقاطي|كم رصيدي|كم نقاطي|الرصيد)$/.test(normalizedBody)) {
    return {
      debugIntent: "intro",
      reply: await getWalletReply(message.from)
    };
  }

  if (/^(رابط دعوتي|كود دعوتي|دعوتي|رابط الاحالة|كود الاحالة|الاحالة)$/.test(normalizedBody)) {
    const wallet = await ensureWallet(message.from);
    const referralCode = String(wallet?.referral_code ?? makeReferralCode(message.from));

    return {
      debugIntent: "intro",
      reply: [
        "╭──────────────",
        "🔗 *دعوتك في الديارة*",
        "╰──────────────",
        "",
        "كود الدعوة",
        `*${referralCode}*`,
        "",
        "━━━━━━━━━━━━━━",
        "رابط الدعوة",
        makeReferralLink(referralCode),
        "",
        "━━━━━━━━━━━━━━",
        "📣 عمولتك",
        "أي شخص يسجل ويشحن عن طريقك تحصل على *30%* نقاط تسويق."
      ].join("\n")
    };
  }

  if (/^(طلب سحب|اسحب|سحب نقاط|سحب العمولة)$/.test(normalizedBody)) {
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

    await setConversationState(message.from, {
      ...state,
      lastSearchShownCount: shownCount + nextResults.length
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
      return {
        debugIntent: "search_property",
        reply: "أرسل بحثًا أولًا، مثلا: دار للكراء في عرفات. بعدها تقدر تكتب: أرخص، غرفتين، أو أقل من 2500."
      };
    }

    if (!extracted.maxPrice && !extracted.rooms && !extracted.sortBy) {
      await setConversationState(message.from, {
        ...state,
        awaitingMaxPriceFilter: true
      });

      return {
        debugIntent: "search_property",
        reply: [
          "تحب نضيّق البحث كيف؟",
          "",
          "💰 سعر أقصى — اكتب الرقم، مثلا: *2500*",
          "🛏 عدد الغرف — اكتب: *غرفتين*",
          "↕️ الترتيب — اكتب: *أرخص* أو *أغلى*",
          "🏠 دار غير هذه — اكتب: *اخرى*",
          "📍 منطقة ثانية — اكتب اسمها، مثلا: *عرفات*"
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
      const results = await searchActiveProperties(mergedSearch);
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
        reply: `ما حصلت ${mergedSearch.propertyType ?? "عقار"} في ${mergedSearch.area} حاليًا.\n\nاكتب منطقة ثانية أو معلم قريب، مثلا: كارفور أو تفرغ زينة.`
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
    const results = await searchActiveProperties(refinedSearch);
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
      const placeText = areaFromText ?? text;
      return {
        debugIntent: "search_property",
        reply: `ما حصلت نتيجة مناسبة لـ ${placeText} حاليًا.\n\nجرّب منطقة أو معلم ثاني، مثل: تفرغ زينة أو كارفور.`
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
    if (isYes(message.body)) {
      const spend = await spendPointsForListing(message.from);

      if (!spend.ok) {
        return {
          debugIntent: "add_property",
          reply: spend.reply
        };
      }

      const submission = await submitPropertyForReview(message.from, state.draftProperty);

      await setConversationState(message.from, {
        ...state,
        draftProperty: undefined
      });

      return {
        debugIntent: "add_property",
        reply: submission.saved
          ? `✅ ${spend.reply}\n\nتم إرسال الإعلان إلى الإدارة للمراجعة. سنخبرك عند الموافقة أو إذا احتاج الإعلان لتعديل.`
          : "✅ تم تأكيد الإعلان في المحاكي. عند ربط Supabase سيتم حفظه تلقائيًا وإرساله للإدارة للمراجعة."
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

      return {
        debugIntent: "add_property",
        reply:
          "تمام. اكتب الشيء الذي تريد تعديله مثل: السعر 3000، المقاطعة عرفات، المعلم قرب كارفور. أو اكتب إلغاء لحذف المسودة."
      };
    }
  }

  const incomingVideo = message.media.find((item) => item.contentType.startsWith("video/"));
  if (incomingVideo) {
    // Copy it now: the WhatsApp link expires long before the owner confirms the listing.
    const storedPath = await storePropertyMedia(incomingVideo.url, incomingVideo.contentType, message.from);

    const draftProperty = touchDraft({
      ...state.draftProperty,
      hasVideo: true,
      videoUrl: storedPath ?? incomingVideo.url,
      videoContentType: incomingVideo.contentType,
      awaitingConfirmation: Boolean(state.draftProperty?.area && state.draftProperty?.price && state.draftProperty?.landmark)
    });
    await setConversationState(message.from, {
      ...state,
      draftProperty
    });

    return {
      debugIntent: "add_property",
      reply: getNextPropertyQuestion(draftProperty)
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
    if (message.media.some((item) => item.contentType.startsWith("image/"))) {
      return {
        debugIntent: "send_payment_receipt",
        reply: await createCreditTopupRequest(message.from, message.media[0].url)
      };
    }

    return {
      debugIntent: extracted.intent,
      reply: "تم استلام الملف. إذا كان إيصال دفع فسيتم مراجعته من الإدارة، وإذا كان صورة للعقار فسيتم حفظها مع الإعلان."
    };
  }

  const trimmedBody = message.body.trim();
  const draftAwaitsPrice = Boolean(state.draftProperty?.area && !state.draftProperty?.price);
  // A bare number that indexes the last search results is the renter picking a property. It must win
  // over an unfinished listing draft parked in the same conversation, since one phone can be both a
  // renter and an owner. The draft still wins while it is waiting for a price.
  const selectsFromLastResults =
    extracted.intent === "select_property" &&
    !(draftAwaitsPrice && /^\d{2,8}$/.test(trimmedBody)) &&
    Boolean(extracted.selectedIndex && state.lastSearchResults?.[extracted.selectedIndex - 1]);

  if (
    state.draftProperty &&
    !selectsFromLastResults &&
    (extracted.intent === "unknown" || extracted.intent === "select_property" || extracted.intent === "refine_search")
  ) {
    const draftProperty = mergeDraftFromMessage(state.draftProperty, extracted, message.body, activeAreas);

    if (!draftProperty.landmark && state.draftProperty.area && state.draftProperty.price) {
      draftProperty.landmark = message.body.trim();
    }

    draftProperty.awaitingConfirmation = Boolean(
      draftProperty.area && draftProperty.price && draftProperty.landmark && draftProperty.hasVideo
    );

    await setConversationState(message.from, {
      ...state,
      draftProperty: touchDraft(draftProperty)
    });

    return {
      debugIntent: "add_property",
      reply: getNextPropertyQuestion(draftProperty)
    };
  }

  if (state.awaitingContactChoice && message.body.trim() === "1") {
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

    const videoUrl = await getPropertyVideoUrl(state.selectedProperty.id);

    await setConversationState(message.from, {
      ...state,
      selectedPropertyVideoViewed: true
    });

    return {
      debugIntent: "select_property",
      reply: videoUrl
        ? `هذا فيديو الدار:\n${videoUrl}\n\nإذا الدار مناسبة لك وتريد رقم المؤجر، اكتب: 1`
        : "الفيديو غير متوفر لهذا الإعلان حاليًا. جرّب اختيار دار ثانية أو اكتب بحث جديد."
    };
  }

  switch (extracted.intent) {
    case "greeting":
      return {
        debugIntent: "greeting",
        reply: "وعليكم السلام، أهلًا بيك. نحن الديارة هون لمساعدتكم. تبحث عن دار للكراء أو عندك عقار تحب تعرضه؟"
      };

    case "intro":
      return {
        debugIntent: "intro",
        reply: "نحن الديارة هون لمساعدتكم. اكتب مثلًا: أريد شقة في عرفات، أو: عندي شقة للإيجار."
      };

    case "add_property": {
      const draftProperty = mergeDraftFromMessage(state.draftProperty ?? {}, extracted, message.body, activeAreas);
      draftProperty.awaitingConfirmation = Boolean(
        draftProperty.area && draftProperty.price && draftProperty.landmark && draftProperty.hasVideo
      );

      await setConversationState(message.from, {
        ...state,
        draftProperty: touchDraft(draftProperty)
      });

      return {
        debugIntent: "add_property",
        reply: getNextPropertyQuestion(draftProperty)
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

        const results = await searchActiveProperties(extracted);

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
            reply:
              "ما حصلت نتيجة مناسبة حاليًا.\n\nاكتب منطقة أو معلم ثاني ونبحث لك مباشرة."
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
          return {
            debugIntent: "select_property",
            reply: "ما لقيت هذا الرقم في آخر النتائج.\n\nاختر رقمًا من القائمة أو أرسل بحثًا جديدًا."
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
        reply: getPointsTopupInstructions()
      };

    default:
      return {
        debugIntent: "unknown",
        reply: `أهلًا بك. يمكنك إرسال طلب مثل: لدي شقة للإيجار، أو: أريد شقة في تفرغ زينة بحد أقصى 2500. الحقول الأساسية للعقار: ${requiredPropertyFields.join("، ")}.`
      };
  }
}

