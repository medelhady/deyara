import type { IncomingWhatsAppMessage } from "@/lib/whatsapp/types";
import { getServiceSupabase } from "@/lib/supabase/server";
import { extractMessage } from "./extract";
import { mockProperties } from "./mock-data";
import { getConversationState, setConversationState } from "./store";
import type { ConversationResult, DraftProperty } from "./types";

const requiredPropertyFields = ["السعر", "المنطقة", "معلم مشهور قريب", "فيديو للعقار"];
const knownAreas = ["تفرغ زينة", "عرفات", "لكصر", "تيارت", "دار النعيم", "السبخة", "الميناء"];

function isYes(body: string) {
  return /^(نعم|اي|إي|أجل|تمام|صح|موافق|اكد|أكد)$/i.test(body.trim());
}

function isNo(body: string) {
  return /^(لا|لأ|كلا|تعديل|الغاء|إلغاء)$/i.test(body.trim());
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

  const { error } = await supabase.from("properties").insert({
    owner_phone: ownerPhone,
    type: draft.type ?? "غير محدد",
    area: draft.area,
    landmark: draft.landmark,
    price: draft.price,
    rooms: draft.rooms,
    status: "pending_review",
    description: "تم إنشاء الإعلان من محادثة واتساب."
  });

  if (error) {
    console.error("Failed to submit property", error);
    return { saved: false, error: error.message };
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

export async function handleIncomingMessage(message: IncomingWhatsAppMessage): Promise<ConversationResult> {
  const extracted = extractMessage(message.body);
  const state = await getConversationState(message.from);

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

  if (message.media.some((item) => item.contentType.startsWith("video/"))) {
    const draftProperty = {
      ...state.draftProperty,
      hasVideo: true,
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

  switch (extracted.intent) {
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
        const results = mockProperties
          .filter((property) => !extracted.area || property.area === extracted.area)
          .filter((property) => !extracted.propertyType || property.type === extracted.propertyType)
          .filter((property) => !extracted.maxPrice || property.price <= extracted.maxPrice)
          .slice(0, 5);

        await setConversationState(message.from, {
          ...state,
          lastSearchResults: results
        });

        if (results.length === 0) {
          return {
            debugIntent: "search_property",
            reply:
              "لم أجد عقارًا مطابقًا الآن. سأحفظ طلبك، وعند وصول عقار مناسب يمكن تنبيهك بعد تفعيل الإشعارات."
          };
        }

        return {
          debugIntent: "search_property",
          reply: `وجدت ${results.length} عقارات مناسبة:\n\n${results
            .map(
              (property, index) =>
                `${index + 1}. ${property.title}\nالسعر: ${property.price}\nالمنطقة: ${property.area}\nالمعلم: ${property.landmark}`
            )
            .join("\n\n")}\n\nاكتب رقم العقار لعرض التفاصيل بدون أرقام.`
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
          selectedPropertyId: selected.id
        });

        return {
          debugIntent: "select_property",
          reply: `${selected.title}\nالسعر: ${selected.price}\nالغرف: ${selected.rooms ?? "غير محدد"}\nالمنطقة: ${selected.area}\nالمعلم القريب: ${selected.landmark}\n\nالأرقام مخفية. لطلب رقم المؤجر أرسل: طلب تواصل.`
        };
      }

    case "request_contact":
      if (!state.selectedPropertyId) {
        return {
          debugIntent: "request_contact",
          reply: "اختر عقارًا أولًا من نتائج البحث، ثم أرسل: طلب تواصل."
        };
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

