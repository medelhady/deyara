import { getServiceSupabase } from "@/lib/supabase/server";

export type AppSettings = {
  contactRevealPoints: number;
  listingFeePoints: number;
  referralCommissionPercent: number;
  minimumWithdrawalPoints: number;
  pointsPaymentNumber: string;
};

export type SettingKey = keyof AppSettings;

type SettingDefinition = {
  key: SettingKey;
  column: string;
  label: string;
  hint: string;
  kind: "number" | "text";
  fallback: () => string;
};

// The single source of truth for what is configurable, shared by the reader, the API and the page.
export const settingDefinitions: SettingDefinition[] = [
  {
    key: "contactRevealPoints",
    column: "contact_reveal_points",
    label: "تكلفة طلب رقم المؤجر",
    hint: "النقاط التي تُخصم من المستأجر مقابل كل رقم يستلمه.",
    kind: "number",
    fallback: () => process.env.CONTACT_REQUEST_FEE ?? "1"
  },
  {
    key: "listingFeePoints",
    column: "listing_fee_points",
    label: "تكلفة نشر إعلان عقار",
    hint: "النقاط التي تُخصم من المالك لحظة موافقة الإدارة على النشر.",
    kind: "number",
    fallback: () => "2000"
  },
  {
    key: "referralCommissionPercent",
    column: "referral_commission_percent",
    label: "نسبة عمولة المسوّقين (%)",
    hint: "نسبة نقاط التسويق التي يحصل عليها صاحب الإحالة من كل شحنة.",
    kind: "number",
    fallback: () => "30"
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
    return defaults;
  }

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
    return { saved: false, error: error.message };
  }

  clearSettingsCache();
  return { saved: true };
}
