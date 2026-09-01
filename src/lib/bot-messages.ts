import { getServiceSupabase } from "@/lib/supabase/server";

/**
 * The bot messages an admin can reword from the dashboard.
 *
 * Deliberately a short list. Most of the bot's text is shaped by the logic around it -- search
 * results, error paths, the owner contact card -- and exposing those invites a broken message
 * nobody notices until a user complains. What is here is the text whose wording is a business
 * decision rather than a technical one.
 *
 * Three rules keep an edit from breaking a conversation:
 *  - a message declares the variables it may use, and saving an unknown one is refused
 *  - an empty stored value falls back to the text in the code, so a message is never blank
 *  - a variable the caller does not supply renders as empty rather than as a literal {name}
 */

export type MessageVariable = {
  name: string;
  sample: string;
  note: string;
};

export type MessageDefinition = {
  key: string;
  label: string;
  note: string;
  variables: MessageVariable[];
  fallback: string;
};

export const messageDefinitions: MessageDefinition[] = [
  {
    key: "greeting",
    label: "رد التحية",
    note: "أول ما يسلّم عليك أحد قبل أن يقول ماذا يريد. اترك {salutation} في أوله ليرد على التحية بمثلها.",
    variables: [
      {
        name: "salutation",
        sample: "صباح النور",
        note: "الرد المناسب لتحيته: صباح النور لصباح الخير، وعليكم السلام للسلام عليكم"
      }
    ],
    fallback:
      "{salutation}. نحن الديارة هون لمساعدتكم. تبحث عن دار للكراء أو عندك عقار تحب تعرضه؟"
  },
  {
    key: "intro",
    label: "التعريف بالخدمة",
    note: "يُرسل حين لا يتضح ما يريده المستخدم. اجعله يقترح عليه ماذا يكتب.",
    variables: [],
    fallback: "نحن الديارة هون لمساعدتكم. اكتب مثلًا: أريد شقة في عرفات، أو: عندي شقة للإيجار."
  },
  {
    key: "no_results",
    label: "لا توجد نتائج",
    note: "حين لا يجد البحث أي دار. سطر {place} يختفي وحده إن لم يكن المكتوب اسم مكان، و{available} تُملأ من الإعلانات المنشورة فعلًا.",
    variables: [
      { name: "place", sample: "تنسويلم", note: "ما بحث عنه المستخدم، وقد يكون فارغًا" },
      {
        name: "available",
        sample: "المتوفر الآن:\n• لكصر — 12 دار\n• تفرغ زينة — 10 دور",
        note: "قائمة المقاطعات التي فيها إعلانات الآن بعنوانها، وتختفي كلها إن لم يكن هناك أي إعلان منشور"
      }
    ],
    fallback: [
      "ما عندنا دور في {place} حاليًا.",
      "",
      "جرّب تبحث عن المقاطعة اللي فيها منطقتك، ممكن تطلع لك نتائج.",
      "",
      "{available}",
      "",
      "اكتب اسم المقاطعة اللي تناسبك."
    ].join("\n")
  },
  {
    key: "referral_welcome",
    label: "الترحيب بمن سجّل عبر دعوة",
    note: "أول رسالة يقرأها المدعو. أهم سطر فيها هو ما يخبره بما يكتبه الآن.",
    variables: [
      { name: "points", sample: "3000", note: "هدية الترحيب" },
      {
        name: "areas",
        sample: "تفرغ زينة، عرفات، لكصر",
        note: "مناطق فيها إعلانات فعلًا الآن، تتحدث تلقائيًا"
      }
    ],
    fallback: [
      "✅ أهلًا بك في الديارة — بوت البحث عن منازل للإيجار.",
      "",
      "🎁 أضفنا لك *{points} أوقية* للتجربة مجانًا.",
      "",
      "🔍 للبحث، اكتب اسم المنطقة فقط. مثلًا:",
      "{areas}",
      "",
      "🏠 وإن كان لديكم منزل للإيجار، اكتب: *عندي منزل*"
    ].join("\n")
  },
  {
    key: "referral_pitch",
    label: "رسالة دعوة المسوّق",
    note: "الرسالة التي ينسخها المسوّق ويرسلها لعملائه. تصل وحدها ليسهل تحويلها.",
    variables: [
      { name: "welcomePoints", sample: "1", note: "أوقية الترحيب لمن يسجل عبر الرابط" },
      { name: "link", sample: "https://wa.me/22248404036?text=ابدأ%20A1B2", note: "رابط الدعوة" }
    ],
    fallback: [
      "السلام عليكم، هذا بوت الديارة للبحث عن الإيجارات وعرضها على واتساب.",
      "سجّل من الرابط واكسب *{welcomePoints} أوقية* مجانية لتجربة الخدمة 🎁",
      "{link}"
    ].join("\n")
  },
  {
    key: "topup_instructions",
    label: "تعليمات شحن الرصيد",
    note: "تُرسل حين ينفد رصيد المستخدم. سطر الرصيد يختفي وحده في المواضع التي لا يكون الرصيد معروفًا فيها.",
    variables: [
      { name: "paymentNumber", sample: "22245678901", note: "رقم استقبال الدفع" },
      {
        name: "purpose",
        sample: "🔐 عرض رقم المؤجر يحتاج *2000 أوقية*.",
        note: "سبب الشحن، ويتغير بحسب ما كان المستخدم يحاول فعله"
      },
      { name: "balance", sample: "0", note: "رصيد المستخدم الحالي، وقد لا يكون معروفًا" },
      { name: "revealPoints", sample: "1", note: "تكلفة عرض رقم المؤجر بالأوقية" }
    ],
    fallback: [
      // Ordered as the reader needs it: what they were trying to do, what they have, then how to
      // fix it. Leading with the balance asks someone to care about a number before saying why.
      //
      // The reason is a variable, not a fixed sentence: the same instructions are sent whether the
      // user was publishing a listing or asking for an owner's number.
      "{purpose}",
      "💼 رصيدك الحالي: *{balance} أوقية*",
      "",
      "╭──────────────",
      "💳 *شحن رصيد الديارة*",
      "╰──────────────",
      "",
      "1️⃣ حوّل مبلغ الشحن إلى هذا الرقم:",
      "*{paymentNumber}*",
      "",
      "2️⃣ بعد التحويل أرسل صورة الإيصال هنا.",
      "",
      "3️⃣ بعد موافقة الإدارة تضاف الأوقية لرصيدك مباشرة.",
      "",
      "📌 لمتابعة رصيدك اكتب: *رصيدي*",
      "",
      "🎁 أو اكسب رصيدًا مجانيًا بدعوة غيرك — اكتب: *إحالاتي*"
    ].join("\n")
  },
  {
    key: "topup_received",
    label: "تأكيد استلام الإيصال",
    note: "تصل فور إرسال صورة الإيصال، قبل مراجعتك. مهمتها أن تطمئنه أن الإيصال وصل ولا يعيد إرساله.",
    variables: [],
    fallback: [
      "✅ تم استلام إيصال شحن الأوقية.",
      "",
      "سيتم مراجعته من الإدارة، وبعد الموافقة تضاف الأوقية إلى رصيدك.",
      "يمكنك كتابة *رصيدي* في أي وقت لمتابعة رصيدك."
    ].join("\n")
  },
  {
    key: "topup_approved",
    label: "تأكيد اعتماد الشحن",
    note: "تصل من حوّل مبلغًا فور اعتماد شحنه. تعديلها هنا لا يغيّر قالب واتساب الذي يُرسل حين تكون نافذة الرد مقفلة.",
    variables: [
      { name: "points", sample: "2000", note: "المبلغ المضاف" },
      { name: "balance", sample: "2000", note: "الرصيد بعد الإضافة" }
    ],
    fallback: [
      "✅ *تم اعتماد شحنك*",
      "",
      "أضفنا *{points} أوقية* إلى رصيدك.",
      "رصيدك الآن: *{balance} أوقية*"
    ].join("\n")
  },
  {
    key: "listing_refresh",
    label: "تذكير المؤجر بمراجعة إعلاناته",
    note: "تُرسل دوريًا لمن له إعلانات لم تُحدَّث. غرضها أن يزيل ما تأجّر، حتى لا يدفع مستأجر مقابل دار غير متاحة.",
    variables: [
      { name: "count", sample: "3", note: "عدد إعلاناته المنشورة" },
      { name: "listings", sample: "• *0007* — تفرغ زينة\n• *0008* — عرفات", note: "قائمة الإعلانات" },
      { name: "firstCode", sample: "0007", note: "رقم أول إعلان، للمثال في نص الأمر" }
    ],
    fallback: [
      "📋 *مراجعة إعلاناتك في الديارة*",
      "",
      "لديك *{count}* إعلان منشور:",
      "{listings}",
      "",
      "إن تأجّر أيٌّ منها، اكتب: *تم تأجير {firstCode}*",
      "",
      "هذا يوفّر عليك مكالمات عن دار لم تعد متاحة."
    ].join("\n")
  },
  {
    key: "video_request",
    label: "طلب فيديو العقار",
    note: "يُطلب من المؤجر حتى يصل الفيديو، ويتكرر مع كل رسالة ليست فيديو — فهو الموضع الأنسب للتنبيه على عدم وضع الرقم داخله.",
    variables: [],
    fallback: [
      "أرسل فيديو واضح للعقار من فضلك. الفيديو ضروري قبل مراجعة الإدارة.",
      "",
      "ولا تضع رقمك داخل الفيديو — رقمك يصل للمستأجر الجاد وحده، فترتاح من مكالمات من لا ينوي الكراء."
    ].join("\n")
  },
  {
    key: "video_rejected",
    label: "الفيديو غير صالح للإرسال",
    note: "يُرسل للمؤجر حين يكون فيديوه بصيغة لا يقبلها واتساب. السبب التقني يُحفظ في السجلات، وهذه الرسالة للمؤجر — فاجعلها فعلًا يقدر عليه لا شرحًا تقنيًا.",
    variables: [],
    fallback: [
      "⚠️ ما قدرنا نستعمل هذا الفيديو.",
      "",
      "صوّر الدار بكاميرا هاتفك وأرسل الفيديو من واتساب مباشرة.",
      "",
      "الفيديوهات المعدَّلة ببرامج المونتاج (مثل كاب كات) لا يقبلها واتساب غالبًا."
    ].join("\n")
  },
  {
    key: "listing_rejected",
    label: "إشعار رفض الإعلان",
    note: "يصل المؤجر حين تُرفض إعلانه. سطر السبب يختفي وحده إن لم تكتب سببًا.",
    variables: [
      { name: "code", sample: "0007", note: "رقم الإعلان" },
      { name: "reason", sample: "الفيديو غير واضح", note: "سبب الرفض، قد يكون فارغًا" }
    ],
    fallback: [
      "❌ تم رفض إعلانك من الإدارة.",
      "",
      "رقم الإعلان: {code}",
      "السبب: {reason}",
      "",
      "يمكنك تعديل البيانات وإعادة الإرسال."
    ].join("\n")
  }
];

const definitionsByKey = new Map(messageDefinitions.map((definition) => [definition.key, definition]));

/** Every `{name}` in a template, whether or not it is one the message is allowed to use. */
export function variablesUsedIn(body: string) {
  return [...body.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]);
}

/**
 * The variables in a body that the message does not declare.
 *
 * This is the check that makes editing safe: a typo like {welcomPoints} would otherwise be sent to
 * a real user as either a literal brace or a silently missing number.
 */
export function unknownVariables(key: string, body: string) {
  const definition = definitionsByKey.get(key);

  if (!definition) {
    return [];
  }

  const allowed = new Set(definition.variables.map((variable) => variable.name));

  return [...new Set(variablesUsedIn(body))].filter((name) => !allowed.has(name));
}

function isEmptyValue(value: string | number | undefined | null) {
  return value === undefined || value === null || String(value).trim() === "";
}

/**
 * Fills a template.
 *
 * A line whose variables all came back empty is dropped whole, so an optional value like a rejection
 * reason leaves no dangling "السبب:" behind. A line with no variables is never touched, so the blank
 * lines an admin typed for spacing survive.
 */
export function renderMessage(template: string, values: Record<string, string | number | undefined>) {
  const lines = template
    .split("\n")
    .filter((line) => {
      const names = variablesUsedIn(line);

      return names.length === 0 || !names.every((name) => isEmptyValue(values[name]));
    })
    .map((line) =>
      line.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name: string) =>
        isEmptyValue(values[name]) ? "" : String(values[name])
      )
    );

  /**
   * Tidies the gaps a dropped line leaves behind.
   *
   * A line surrounded by the blank lines an admin typed for spacing takes only itself when it goes,
   * leaving the message opening on an empty line or carrying a double gap in the middle. One blank
   * line is spacing; two is the hole where something used to be.
   */
  const tidied: string[] = [];

  for (const line of lines) {
    const blank = line.trim() === "";

    if (blank && (tidied.length === 0 || tidied[tidied.length - 1].trim() === "")) {
      continue;
    }

    tidied.push(line);
  }

  while (tidied.length > 0 && tidied[tidied.length - 1].trim() === "") {
    tidied.pop();
  }

  return tidied.join("\n");
}

const cacheTtlMs = 30 * 1000;
let cached: { value: Map<string, string>; readAt: number } | null = null;

export function clearBotMessageCache() {
  cached = null;
}

async function readStored() {
  if (cached && Date.now() - cached.readAt <= cacheTtlMs) {
    return cached.value;
  }

  const supabase = getServiceSupabase();
  const stored = new Map<string, string>();

  if (!supabase) {
    return stored;
  }

  const { data, error } = await supabase.from("bot_messages").select("key,body");

  if (error) {
    // A missing table or a database hiccup falls back to the shipped text rather than failing.
    return stored;
  }

  for (const row of data ?? []) {
    stored.set(String(row.key), String(row.body ?? ""));
  }

  cached = { value: stored, readAt: Date.now() };
  return stored;
}

/** The template for a message: the admin's version when there is one, otherwise the shipped text. */
export async function getMessageTemplate(key: string) {
  const definition = definitionsByKey.get(key);

  if (!definition) {
    throw new Error(`Unknown bot message: ${key}`);
  }

  const stored = await readStored();
  const custom = stored.get(key)?.trim();

  return custom || definition.fallback;
}

/** Reads a message and fills its variables in one step. */
export async function getMessage(key: string, values: Record<string, string | number | undefined> = {}) {
  return renderMessage(await getMessageTemplate(key), values);
}

export async function readMessageRows() {
  const stored = await readStored();

  return messageDefinitions.map((definition) => ({
    key: definition.key,
    label: definition.label,
    note: definition.note,
    variables: definition.variables,
    fallback: definition.fallback,
    body: stored.get(definition.key)?.trim() || "",
    isCustom: Boolean(stored.get(definition.key)?.trim())
  }));
}

export async function saveMessage(key: string, body: string, updatedBy: string | null) {
  const definition = definitionsByKey.get(key);

  if (!definition) {
    return { saved: false as const, error: "رسالة غير معروفة." };
  }

  const unknown = unknownVariables(key, body);

  if (unknown.length > 0) {
    return {
      saved: false as const,
      error: `متغيرات غير معروفة: ${unknown.map((name) => `{${name}}`).join("، ")}. المتاح لهذه الرسالة: ${
        definition.variables.map((variable) => `{${variable.name}}`).join("، ") || "لا يوجد"
      }.`
    };
  }

  const supabase = getServiceSupabase();

  if (!supabase) {
    return { saved: false as const, error: "قاعدة البيانات غير مربوطة." };
  }

  const { error } = await supabase.from("bot_messages").upsert(
    { key, body: body.trim(), updated_at: new Date().toISOString(), updated_by: updatedBy },
    { onConflict: "key" }
  );

  if (error) {
    const missingTable = error.code === "PGRST205" || (error.message ?? "").includes("bot_messages");

    return {
      saved: false as const,
      error: missingTable
        ? "جدول رسائل البوت bot_messages غير موجود. شغّل ملف supabase/add-bot-messages.sql في محرر SQL بـ Supabase ثم أعد المحاولة."
        : error.message
    };
  }

  clearBotMessageCache();
  return { saved: true as const };
}
