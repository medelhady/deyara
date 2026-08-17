import type { ExtractedMessage, Intent } from "./types";

const allowedIntents: Intent[] = [
  "greeting",
  "intro",
  "add_property",
  "search_property",
  "refine_search",
  "select_property",
  "request_contact",
  "send_payment_receipt",
  "unknown"
];

function buildSystemPrompt(areas: string[]) {
  return [
    "أنت مساعد يحلل رسائل واتساب لمنصة عقارية اسمها الديارة، تعمل بالعربية (لهجات مختلطة موريتانية وخليجية وفصحى).",
    "مهمتك: تحديد نية المستخدم (intent) واستخراج الحقول ذات الصلة فقط، وإرجاعها بصيغة JSON صارمة.",
    "",
    `الأنواع الممكنة لـ intent: ${allowedIntents.join(", ")}.`,
    "",
    "معنى كل نوع:",
    "- greeting: تحية بسيطة (سلام، مرحبا).",
    "- intro: طلب شرح عام عن الخدمة.",
    "- add_property: المستخدم يملك عقاراً ويريد عرضه للإيجار (يقول عندي/لدي دار أو شقة، أو يجيب على سؤال تعبئة إعلان مثل السعر أو المعلم القريب).",
    "- search_property: المستخدم يبحث عن سكن للإيجار.",
    "- refine_search: المستخدم يريد تعديل نتائج بحث سابق (أرخص، أغلى، عدد غرف، حد أقصى للسعر).",
    "- select_property: المستخدم يختار رقم عقار من قائمة نتائج (رقم فقط).",
    "- request_contact: المستخدم يطلب رقم صاحب العقار.",
    "- send_payment_receipt: المستخدم يشير إلى إيصال أو تحويل دفع.",
    "- unknown: أي رسالة غير واضحة، أو رد عام لا يحدد نية جديدة (مثل الإجابة على سؤال تعبئة إعلان: منطقة، سعر، أو معلم قريب دون كلمات صريحة).",
    "",
    `أسماء مناطق معروفة (استخدمها إن وردت أو شابهتها): ${areas.join("، ")}.`,
    "",
    "أرجع فقط JSON بالحقول التالية (احذف أي حقل غير منطبق، لا تخترع قيماً):",
    `{"intent": "...", "propertyType": "شقة|منزل|فيلا|غرفة|محل|مكتب", "area": "...", "landmark": "...", "price": رقم, "maxPrice": رقم, "searchText": "...", "rooms": رقم, "selectedIndex": رقم, "sortBy": "cheapest|expensive"}`,
    "لا تكتب أي نص خارج JSON."
  ].join("\n");
}

export async function aiExtractMessage(text: string, areas: string[]): Promise<ExtractedMessage | null> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildSystemPrompt(areas) },
          { role: "user", content: text }
        ]
      })
    });

    if (!response.ok) {
      console.error("AI extract failed", await response.text());
      return null;
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;

    if (!content) {
      return null;
    }

    const parsed = JSON.parse(content);

    if (!allowedIntents.includes(parsed.intent)) {
      return null;
    }

    const result: ExtractedMessage = { intent: parsed.intent as Intent };

    if (typeof parsed.propertyType === "string") result.propertyType = parsed.propertyType;
    if (typeof parsed.area === "string") result.area = parsed.area;
    if (typeof parsed.landmark === "string") result.landmark = parsed.landmark;
    if (typeof parsed.price === "number") result.price = parsed.price;
    if (typeof parsed.maxPrice === "number") result.maxPrice = parsed.maxPrice;
    if (typeof parsed.searchText === "string") result.searchText = parsed.searchText;
    if (typeof parsed.rooms === "number") result.rooms = parsed.rooms;
    if (typeof parsed.selectedIndex === "number") result.selectedIndex = parsed.selectedIndex;
    if (parsed.sortBy === "cheapest" || parsed.sortBy === "expensive") result.sortBy = parsed.sortBy;

    return result;
  } catch (error) {
    console.error("AI extract error", error);
    return null;
  }
}