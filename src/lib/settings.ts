import { getServiceSupabase } from "@/lib/supabase/server";

export type AppSettings = {
  contactRevealPoints: number;
  listingFeePoints: number;
  referralCommissionPercent: number;
  minimumWithdrawalPoints: number;
  listingRefreshHours: number;
  pointsPaymentNumber: string;
  botWhatsAppNumber: string;
  referralWindowMonths: number;
  referralWelcomePoints: number;
  referralSignupBonusPoints: number;
  referralMinTopupPoints: number;
  adminNotifyNumbers: string;
  demoEnabled: string;
  collectionMode: string;
};

export type SettingKey = keyof AppSettings;

type SettingDefinition = {
  key: SettingKey;
  column: string;
  label: string;
  hint: string;
  kind: "number" | "text" | "textarea";
  fallback: () => string;
};

// The single source of truth for what is configurable, shared by the reader, the API and the page.
export const settingDefinitions: SettingDefinition[] = [
  {
    key: "contactRevealPoints",
    column: "contact_reveal_points",
    label: "تكلفة طلب رقم المؤجر",
    hint: "الأوقية التي تُخصم من المستأجر مقابل كل رقم يستلمه.",
    kind: "number",
    fallback: () => process.env.CONTACT_REQUEST_FEE ?? "1"
  },
  {
    key: "listingFeePoints",
    column: "listing_fee_points",
    label: "تكلفة نشر إعلان عقار",
    hint: "الأوقية التي تُخصم من المالك لحظة موافقة الإدارة على النشر.",
    kind: "number",
    fallback: () => "2000"
  },
  {
    key: "referralCommissionPercent",
    column: "referral_commission_percent",
    label: "نسبة عمولة المسوّقين (%)",
    hint: "نسبة رصيد التسويق التي يحصل عليها صاحب الإحالة من كل شحنة.",
    kind: "number",
    fallback: () => "30"
  },
  {
    key: "listingRefreshHours",
    column: "listing_refresh_hours",
    label: "كل كم ساعة يُذكَّر المؤجر بمراجعة إعلاناته",
    hint: "لا يُذكَّر إلا من له إعلان لم يُحدَّث خلال هذه المدة، ولا يتكرر التذكير قبل انقضائها. اجعلها 0 لإيقاف التذكير.",
    kind: "number",
    fallback: () => "48"
  },
  {
    key: "minimumWithdrawalPoints",
    column: "minimum_withdrawal_points",
    label: "الحد الأدنى لطلب السحب",
    hint: "أقل رصيد عمولة يسمح بطلب السحب.",
    kind: "number",
    fallback: () => "500"
  },
  {
    key: "adminNotifyNumbers",
    column: "admin_notify_numbers",
    label: "أرقام تنبيهات الإدارة",
    hint: "بصيغة دولية كاملة مع رمز الدولة مثل 22245678901، وافصل بينها بفاصلة. اتركه فارغًا لإيقاف التنبيهات.",
    kind: "text",
    fallback: () => process.env.ADMIN_WHATSAPP_NUMBERS ?? ""
  },
  {
    key: "collectionMode",
    column: "collection_mode",
    label: "وضع التجميع",
    hint: "اكتب on لتشغيله. البوت يسأل ثلاثة أسئلة ويسجّل، بلا فيديو ولا رسوم ولا خصم — للمرحلة التي لا يوجد فيها معروض بعد. اكتب off لعودة الآلية الكاملة.",
    kind: "text",
    // Falls back to an environment variable, like the admin numbers do: the mode can be switched on
    // before the column exists, and it gives the offline checks a way in.
    fallback: () => process.env.COLLECTION_MODE ?? "off"
  },
  {
    key: "demoEnabled",
    column: "demo_enabled",
    label: "وضع التجربة للمسوّقين",
    hint: "اكتب off لإيقافه. كل رسالة تجريبية تستدعي الذكاء الاصطناعي وتُحتسب عليك، فأوقفه إن كثر الفضوليون.",
    kind: "text",
    fallback: () => "on"
  },
  {
    key: "referralWelcomePoints",
    column: "referral_welcome_points",
    label: "أوقية ترحيب للمسجّل عبر دعوة",
    hint: "تُمنح فورًا لمن يسجل عبر رابط مسوّق. اجعلها 0 لإيقافها.",
    kind: "number",
    fallback: () => "1"
  },
  {
    key: "referralSignupBonusPoints",
    column: "referral_signup_bonus_points",
    label: "مكافأة المسوّق عند التسجيل",
    hint: "رصيد استخدام تُمنح للمسوّق فور تسجيل شخص برابطه، قبل أي شحن. اجعلها 0 لإيقافها.",
    kind: "number",
    fallback: () => "300"
  },
  {
    key: "referralMinTopupPoints",
    column: "referral_min_topup_points",
    label: "أقل شحنة تستحق عمولة",
    hint: "لا تُحتسب عمولة إحالة لشحنة أقل من هذا. اجعلها 0 لاحتساب كل الشحنات.",
    kind: "number",
    fallback: () => "0"
  },
  {
    key: "botWhatsAppNumber",
    column: "bot_whatsapp_number",
    label: "رقم واتساب البوت",
    hint: "الرقم الذي تفتح عليه روابط الدعوة محادثة مع البوت. بصيغة دولية كاملة مثل 22248404036.",
    kind: "text",
    fallback: () => process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? ""
  },
  {
    key: "referralWindowMonths",
    column: "referral_window_months",
    label: "مدة عمولة الإحالة (شهر)",
    hint: "تُحتسب العمولة على شحنات المُحال خلال هذه المدة من تاريخ تسجيله، ثم تتوقف.",
    kind: "number",
    fallback: () => "12"
  },
  {
    key: "pointsPaymentNumber",
    column: "points_payment_number",
    label: "رقم استقبال الدفع",
    hint: "الرقم الذي يحوّل إليه المستخدمون مبلغ الشحن.",
    kind: "text",
    fallback: () =>
      process.env.POINTS_PAYMENT_NUMBER ??
      process.env.ADMIN_WHATSAPP_NUMBERS?.split(",")[0]?.replace("whatsapp:", "") ??
      ""
  }
];

function buildDefaults(): AppSettings {
  const defaults = {} as AppSettings;

  for (const definition of settingDefinitions) {
    const raw = definition.fallback();

    if (definition.kind === "number") {
      (defaults[definition.key] as number) = Number(raw) || 0;
    } else {
      (defaults[definition.key] as string) = raw;
    }
  }

  return defaults;
}

// Every incoming message reads these, so keep a short cache instead of hitting the database each
// time. A change from the dashboard takes effect within the TTL without a redeploy.
const cacheTtlMs = 30 * 1000;
let cached: { value: AppSettings; readAt: number } | null = null;
let settingsTableMissing = false;

export function isSettingsTableMissing() {
  return settingsTableMissing;
}

export function clearSettingsCache() {
  cached = null;
}

export async function getSettings(): Promise<AppSettings> {
  if (cached && Date.now() - cached.readAt <= cacheTtlMs) {
    return cached.value;
  }

  const defaults = buildDefaults();
  const supabase = getServiceSupabase();

  if (!supabase) {
    return defaults;
  }

  const { data, error } = await supabase.from("app_settings").select("key,value");

  if (error) {
    console.error("Failed to read app settings", error);
    settingsTableMissing = error.code === "PGRST205" || (error.message ?? "").includes("app_settings");
    return defaults;
  }

  settingsTableMissing = false;

  const stored = new Map((data ?? []).map((row) => [row.key as string, String(row.value ?? "")]));
  const settings = { ...defaults };

  for (const definition of settingDefinitions) {
    const raw = stored.get(definition.column);

    // An empty stored value means "not configured", so the fallback still applies.
    if (raw === undefined || raw.trim() === "") {
      continue;
    }

    if (definition.kind === "number") {
      const parsed = Number(raw);

      if (Number.isFinite(parsed)) {
        (settings[definition.key] as number) = parsed;
      }

      continue;
    }

    (settings[definition.key] as string) = raw.trim();
  }

  cached = { value: settings, readAt: Date.now() };
  return settings;
}

export async function readSettingRows() {
  const settings = await getSettings();

  return settingDefinitions.map((definition) => ({
    key: definition.column,
    label: definition.label,
    hint: definition.hint,
    kind: definition.kind,
    value: String(settings[definition.key])
  }));
}

// The table ships as a migration an admin has to run, so the most likely failure is that it does not
// exist yet. Say that in Arabic instead of forwarding a PostgREST message.
export const missingTableMessage =
  "جدول الإعدادات app_settings غير موجود في قاعدة البيانات. شغّل ملف supabase/add-settings.sql في محرر SQL بـ Supabase ثم أعد المحاولة.";

function describeSettingsError(error: { code?: string; message?: string }) {
  const message = error.message ?? "";

  if (error.code === "PGRST205" || message.includes("app_settings")) {
    return missingTableMessage;
  }

  return message || "تعذر حفظ الإعدادات.";
}

export async function saveSettings(updates: Record<string, string>) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { saved: false, error: "Supabase is not configured." };
  }

  const rows = settingDefinitions
    .filter((definition) => updates[definition.column] !== undefined)
    .map((definition) => ({
      key: definition.column,
      value: String(updates[definition.column]).trim(),
      updated_at: new Date().toISOString()
    }));

  if (rows.length === 0) {
    return { saved: false, error: "No known setting was provided." };
  }

  const { error } = await supabase.from("app_settings").upsert(rows, { onConflict: "key" });

  if (error) {
    console.error("Failed to save app settings", error);
    return { saved: false, error: describeSettingsError(error) };
  }

  clearSettingsCache();
  return { saved: true };
}
