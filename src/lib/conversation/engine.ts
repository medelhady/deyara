import type { IncomingWhatsAppMessage } from "@/lib/whatsapp/types";
import { getServiceSupabase } from "@/lib/supabase/server";
import { extractMessage } from "./extract";
import { mockProperties } from "./mock-data";
import { getConversationState, setConversationState } from "./store";
import type { ConversationResult, DraftProperty, PropertyCandidate } from "./types";

const requiredPropertyFields = ["السعر", "المنطقة", "معلم مشهور قريب", "فيديو للعقار"];
const knownAreas = ["تفرغ زينة", "عرفات", "لكصر", "تيارت", "دار النعيم", "السبخة", "الميناء"];
const selectionTtlMs = 15 * 60 * 1000;

function isYes(body: string) {
  return /^(نعم|اي|إي|أجل|تمام|صح|موافق|اكد|أكد)$/i.test(body.trim());
}

function isNo(body: string) {
  return /^(لا|لأ|كلا|تعديل|الغاء|إلغاء)$/i.test(body.trim());
}

function hasFreshSelection(state: { selectedProperty?: PropertyCandidate; selectedPropertyAt?: string }) {
  if (!state.selectedProperty || !state.selectedPropertyAt) {
    return false;
  }

  return Date.now() - new Date(state.selectedPropertyAt).getTime() <= selectionTtlMs;
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

function formatSearchResults(
  results: PropertyCandidate[],
  extracted: ReturnType<typeof extractMessage>,
  options?: { startIndex?: number; total?: number; hasMore?: boolean }
) {
  const typeText = extracted.propertyType ? propertyTypeSingular(extracted.propertyType) : "دار";
  const areaText = extracted.area ? ` في ${extracted.area}` : "";
  const startIndex = options?.startIndex ?? 0;
  const total = options?.total ?? results.length;
  const moreText = options?.hasMore ? "\n\nلخيارات أكثر اكتب: 0" : "";

  return `متوفر عدد ${total} ${typeText} للإيجار${areaText}:\n\n${results
    .map(
      (property, index) =>
        `${startIndex + index + 1}. ${property.type} في ${property.area}\nالسعر: ${property.price}\nقريبة من: ${property.landmark}`
    )
    .join("\n\n")}\n\nاكتب رقم الدار اللي اخترت، مثلا: 1\nالفيديو والتفاصيل الكاملة تظهر بعد اختيار الدار.${moreText}`;
}

async function submitPropertyForReview(
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
  body: string
) {
  const areaFromText = knownAreas.find((area) => body.includes(area));
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
    .maybeSingle();

  if (existing) {
    return { saved: true, existing: true, id: existing.id as string, status: existing.status as string };
  }

  const { data, error } = await supabase
    .from("contact_requests")
    .insert({
      property_id: selected.id,
      renter_phone: renterPhone,
      owner_phone: selected.ownerPhone,
      status: "pending_payment",
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

async function savePaymentReceipt(contactRequestId: string, receiptUrl: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { saved: false };
  }

  const { error: paymentError } = await supabase.from("payments").insert({
    contact_request_id: contactRequestId,
    receipt_image_url: receiptUrl,
    status: "pending"
  });

  if (paymentError) {
    console.error("Failed to save payment receipt", paymentError);
    return { saved: false, error: paymentError.message };
  }

  const { error: requestError } = await supabase
    .from("contact_requests")
    .update({
      status: "pending_admin_review"
    })
    .eq("id", contactRequestId);

  if (requestError) {
    console.error("Failed to update contact request after receipt", requestError);
    return { saved: false, error: requestError.message };
  }

  return { saved: true };
}

export async function handleIncomingMessage(message: IncomingWhatsAppMessage): Promise<ConversationResult> {
  const extracted = extractMessage(message.body);
  const state = await getConversationState(message.from);

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

  if (state.pendingSearch && extracted.intent === "unknown") {
    const areaFromText = knownAreas.find((area) => message.body.includes(area));
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
          reply: `ما حصلت ${mergedSearch.propertyType ?? "عقار"} في ${mergedSearch.area} الآن. اكتب منطقة أو معلم ثاني ونبحث لك مباشرة.`
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

  if (state.lastSearchQuery && extracted.intent === "unknown") {
    const areaFromText = knownAreas.find((area) => message.body.includes(area));
    const text = message.body.trim();
    const refinedSearch = {
      ...state.lastSearchQuery,
      area: areaFromText ?? state.lastSearchQuery.area,
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
        reply: `ما حصلت نتيجة مناسبة لـ ${placeText} الآن. جرّب منطقة أو معلم ثاني، مثل: تفرغ زينة أو كارفور.`
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
      const submission = await submitPropertyForReview(message.from, state.draftProperty);

      await setConversationState(message.from, {
        ...state,
        draftProperty: undefined
      });

      return {
        debugIntent: "add_property",
        reply: submission.saved
          ? "✅ تم إرسال الإعلان إلى الإدارة للمراجعة. سنخبرك عند الموافقة أو إذا احتاج الإعلان لتعديل."
          : "✅ تم تأكيد الإعلان في المحاكي. عند ربط Supabase سيتم حفظه تلقائيًا وإرساله للإدارة للمراجعة."
      };
    }

    if (isNo(message.body)) {
      await setConversationState(message.from, {
        ...state,
        draftProperty: {
          ...state.draftProperty,
          awaitingConfirmation: false
        }
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
    const draftProperty = {
      ...state.draftProperty,
      hasVideo: true,
      videoUrl: incomingVideo.url,
      videoContentType: incomingVideo.contentType,
      awaitingConfirmation: Boolean(state.draftProperty?.area && state.draftProperty?.price && state.draftProperty?.landmark)
    };
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
    const draftProperty = {
      ...state.draftProperty,
      hasLocation: true
    };
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
    if (state.activeContactRequestId && message.media.some((item) => item.contentType.startsWith("image/"))) {
      const receipt = await savePaymentReceipt(state.activeContactRequestId, message.media[0].url);

      return {
        debugIntent: "send_payment_receipt",
        reply: receipt.saved
          ? "✅ تم استلام صورة الإيصال. سيتم التحقق من الإدارة، وبعد الموافقة سنرسل رقم المؤجر فقط."
          : "وصلت الصورة، لكن تعذر حفظ الإيصال الآن. حاول مرة أخرى بعد قليل."
      };
    }

    return {
      debugIntent: extracted.intent,
      reply: "تم استلام الملف. إذا كان إيصال دفع فسيتم مراجعته من الإدارة، وإذا كان صورة للعقار فسيتم حفظها مع الإعلان."
    };
  }

  if (state.draftProperty && (extracted.intent === "unknown" || extracted.intent === "select_property")) {
    const draftProperty = mergeDraftFromMessage(state.draftProperty, extracted, message.body);

    if (!draftProperty.landmark && state.draftProperty.area && state.draftProperty.price) {
      draftProperty.landmark = message.body.trim();
    }

    draftProperty.awaitingConfirmation = Boolean(
      draftProperty.area && draftProperty.price && draftProperty.landmark && draftProperty.hasVideo
    );

    await setConversationState(message.from, {
      ...state,
      draftProperty
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
        reply: "اختر دارًا أولًا من آخر نتائج البحث."
      };
    }

    if (!state.selectedPropertyVideoViewed) {
      return {
        debugIntent: "select_property",
        reply: "أولًا شوف فيديو الدار عشان تتأكد إنها مناسبة لك. اكتب 2 لمشاهدة الفيديو."
      };
    }

    const request = await createContactRequest(message.from, state.selectedProperty);

    if (!request.saved) {
      return {
        debugIntent: "request_contact",
        reply: "تعذر إنشاء طلب التواصل الآن. حاول مرة أخرى بعد قليل."
      };
    }

    await setConversationState(message.from, {
      ...state,
      awaitingContactChoice: false,
      activeContactRequestId: request.id
    });

    return {
      debugIntent: "request_contact",
      reply: request.existing
        ? "لديك طلب تواصل سابق لهذا العقار. إذا كنت قد دفعت الرسوم فأرسل صورة الإيصال، وبعد موافقة الإدارة سنرسل رقم المؤجر فقط."
        : "لطلب التواصل مع صاحب العقار يرجى دفع رسوم الطلب ثم إرسال صورة الإيصال. بعد موافقة الإدارة سنرسل رقم المؤجر فقط."
    };
  }

  if (state.awaitingContactChoice && message.body.trim() === "2") {
    if (!state.selectedPropertyId || !state.selectedProperty || !hasFreshSelection(state)) {
      return {
        debugIntent: "select_property",
        reply: "اختر دارًا أولًا من آخر نتائج البحث."
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
        ? `هذا فيديو الدار:\n${videoUrl}\n\nإذا عجبتك الدار وتريد رقم المؤجر، اكتب: 1`
        : "الفيديو غير متوفر لهذا الإعلان حاليًا. سنراجعه من الإدارة. جرّب اختيار دار ثانية أو اكتب بحث جديد."
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
      const draftProperty = mergeDraftFromMessage(state.draftProperty ?? {}, extracted, message.body);
      draftProperty.awaitingConfirmation = Boolean(
        draftProperty.area && draftProperty.price && draftProperty.landmark && draftProperty.hasVideo
      );

      await setConversationState(message.from, {
        ...state,
        draftProperty
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
            reply: `في أي منطقة تبحث عن ${extracted.propertyType ?? "عقار"}؟ مثال: عرفات، تفرغ زينة، لكصر.`
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
              "ما حصلت نتيجة مناسبة الآن. اكتب منطقة أو معلم ثاني ونبحث لك مباشرة."
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
            reply: "لم أجد هذا الاختيار في آخر نتائج. أرسل طلب بحث جديد أو اختر رقمًا من القائمة."
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
          reply: `${selected.type} في ${selected.area}\nالسعر: ${selected.price}\nالغرف: ${selected.rooms ?? "غير محدد"}\nقريبة من: ${selected.landmark}\n\nللمشاهدة قبل التواصل، اكتب 2 وشوف فيديو الدار.\nإذا عجبتك بعد الفيديو، اكتب 1 لطلب رقم المؤجر.`
        };
      }

    case "request_contact":
      if (!state.selectedPropertyId || !state.selectedProperty || !hasFreshSelection(state)) {
        return {
          debugIntent: "request_contact",
          reply: "اختر عقارًا أولًا من آخر نتائج البحث، ثم أرسل: طلب تواصل."
        };
      }

      {
        const request = await createContactRequest(message.from, state.selectedProperty);

        if (!request.saved) {
          return {
            debugIntent: "request_contact",
            reply: "تعذر إنشاء طلب التواصل الآن. حاول مرة أخرى بعد قليل."
          };
        }

        if (request.existing) {
          await setConversationState(message.from, {
            ...state,
            awaitingContactChoice: false,
            activeContactRequestId: request.id
          });

          return {
            debugIntent: "request_contact",
            reply:
              "لديك طلب تواصل سابق لهذا العقار. إذا كنت قد دفعت الرسوم فأرسل صورة الإيصال، وبعد موافقة الإدارة سنرسل رقم المؤجر فقط."
          };
        }

        await setConversationState(message.from, {
          ...state,
          awaitingContactChoice: false,
          activeContactRequestId: request.id
        });
      }

      return {
        debugIntent: "request_contact",
        reply:
          "لطلب التواصل مع صاحب العقار يرجى دفع رسوم الطلب ثم إرسال صورة الإيصال. بعد موافقة الإدارة سنرسل رقم المؤجر فقط."
      };

    case "send_payment_receipt":
      return {
        debugIntent: "send_payment_receipt",
        reply: "أرسل صورة الإيصال هنا. سيتم التحقق من الإدارة خلال دقائق."
      };

    default:
      return {
        debugIntent: "unknown",
        reply: `أهلًا بك. يمكنك إرسال طلب مثل: لدي شقة للإيجار، أو: أريد شقة في تفرغ زينة بحد أقصى 2500. الحقول الأساسية للعقار: ${requiredPropertyFields.join("، ")}.`
      };
  }
}

