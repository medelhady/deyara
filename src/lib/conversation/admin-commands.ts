import { getServiceSupabase } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { creditApprovedTopup, setPropertyStatus, setWithdrawalStatus } from "@/lib/admin-actions";
import { parseAdminCommand } from "./parse-admin-command";

function digitsOf(phone: string) {
  return phone.replace(/\D/g, "");
}

/** WhatsApp authenticates the sender, so matching the configured admin numbers is enough. */
export async function isAdminPhone(phone: string) {
  const { adminNotifyNumbers } = await getSettings();
  const sender = digitsOf(phone);

  if (!sender) {
    return false;
  }

  return adminNotifyNumbers
    .split(",")
    .map((number) => digitsOf(number))
    .filter(Boolean)
    .includes(sender);
}

async function findProperty(reference: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return null;
  }

  const code = reference.trim();

  if (!code) {
    return null;
  }

  const { data: byCode } = await supabase
    .from("properties")
    .select("id,property_code,status,area,type,owner_phone")
    .eq("property_code", code)
    .maybeSingle();

  if (byCode) {
    return byCode;
  }

  // Admins also read the short id off the dashboard, so accept a prefix of it.
  const { data: byId } = await supabase
    .from("properties")
    .select("id,property_code,status,area,type,owner_phone")
    .ilike("id", `${code}%`)
    .limit(2);

  return (byId ?? []).length === 1 ? byId![0] : null;
}

const helpMessage = [
  "🛠 *أوامر الإدارة*",
  "",
  "✅ نشر إعلان",
  "*قبول 0007*",
  "",
  "❌ رفض إعلان (السبب اختياري)",
  "*رفض 0007 الفيديو غير واضح*",
  "",
  "💳 اعتماد شحن",
  "*شحن 22245678901 2000*",
  "",
  "📤 طلبات السحب المعلقة",
  "*سحوبات*",
  "",
  "💸 تأكيد تحويل مستحقات",
  "*دفع 22245678901*",
  "",
  "🚫 رفض طلب سحب (السبب اختياري)",
  "*رفض سحب 22245678901 الرصيد غير كافٍ*",
  "",
  "📌 هذه الأوامر تعمل من أرقام الإدارة فقط."
].join("\n");

/** Finds the withdrawal an admin means by typing a phone number, matched on its digits. */
async function findWithdrawalByPhone(phoneInput: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return null;
  }

  const digits = digitsOf(phoneInput);

  if (!digits) {
    return null;
  }

  // Paying is valid from pending and from approved, since approving is an optional middle step.
  const { data } = await supabase
    .from("withdrawal_requests")
    .select("id,phone,points,status,created_at")
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false })
    .limit(100);

  return (data ?? []).find((row) => digitsOf(String(row.phone)).endsWith(digits)) ?? null;
}

async function listPendingWithdrawals() {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return "❌ قاعدة البيانات غير مربوطة.";
  }

  const { data, error } = await supabase
    .from("withdrawal_requests")
    .select("phone,points,status,created_at")
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    return `❌ ${error.message}`;
  }

  if ((data ?? []).length === 0) {
    return "📤 *طلبات السحب*\n\nلا يوجد طلب سحب معلق.";
  }

  return [
    "📤 *طلبات السحب المعلقة*",
    "",
    ...(data ?? []).map((row) => {
      const number = String(row.phone).replace("whatsapp:", "");
      const state = row.status === "approved" ? "موافق عليه" : "جديد";

      return `• ${number} — *${row.points} أوقية* (${state})`;
    }),
    "",
    "لتأكيد التحويل اكتب: *دفع <الرقم>*"
  ].join("\n");
}

/**
 * Handles an admin instruction sent over WhatsApp. Returns null when the message is not a command,
 * so an admin can still use the bot as a renter or an owner with the same number.
 */
export async function handleAdminCommand(phone: string, body: string): Promise<string | null> {
  const command = parseAdminCommand(body);

  if (!command) {
    return null;
  }

  if (!(await isAdminPhone(phone))) {
    // Say nothing: a normal user typing "رفض" should fall through to the usual conversation.
    return null;
  }

  if (command.kind === "help") {
    return helpMessage;
  }

  if (command.kind === "listWithdrawals") {
    return listPendingWithdrawals();
  }

  if (command.kind === "payWithdrawal" || command.kind === "rejectWithdrawal") {
    const withdrawal = await findWithdrawalByPhone(command.phone);

    if (!withdrawal) {
      return `ما لقيت طلب سحب معلقًا للرقم *${digitsOf(command.phone)}*.\n\nاكتب *سحوبات* لعرض الطلبات المعلقة.`;
    }

    const paying = command.kind === "payWithdrawal";
    const reason = command.kind === "rejectWithdrawal" ? command.reason : "";
    const result = await setWithdrawalStatus(
      String(withdrawal.id),
      paying ? "paid" : "rejected",
      reason || undefined
    );

    if (!result.ok) {
      return `❌ ${result.message}`;
    }

    const number = String(withdrawal.phone).replace("whatsapp:", "");

    return paying
      ? [
          "💸 *تم تأكيد التحويل*",
          "",
          `📱 ${number}`,
          `💰 خُصمت *${withdrawal.points} أوقية* من رصيد عمولته.`,
          "",
          "أُبلغ صاحب الرقم بالتحويل."
        ].join("\n")
      : [
          "🚫 *تم رفض طلب السحب*",
          "",
          `📱 ${number}`,
          `💰 *${withdrawal.points} أوقية* بقيت في رصيده.`,
          ...(reason ? ["", `📝 السبب: ${reason}`] : []),
          "",
          "أُبلغ صاحب الرقم بالرفض."
        ].join("\n");
  }

  if (command.kind === "approveListing" || command.kind === "rejectListing") {
    const property = await findProperty(command.code);

    if (!property) {
      return `ما لقيت إعلانًا برقم *${command.code}*.\n\nتأكد من رقم الإعلان كما يظهر في اللوحة.`;
    }

    const label = property.property_code ?? String(property.id).slice(0, 8);

    if (command.kind === "approveListing") {
      const result = await setPropertyStatus(String(property.id), "active");

      if (!result.ok) {
        return `❌ ${result.message}`;
      }

      const spent = result.data?.spentPoints as number | undefined;

      return [
        "✅ *تم نشر الإعلان*",
        "",
        `🔖 ${label}`,
        `🏠 ${property.type ?? "دار"} في ${property.area ?? "منطقة غير محددة"}`,
        ...(spent ? ["", `تم خصم *${spent} أوقية* من المؤجر وأُبلغ بالنشر.`] : ["", "أُبلغ المؤجر بالنشر."])
      ].join("\n");
    }

    const reason = command.reason;
    const result = await setPropertyStatus(String(property.id), "rejected", reason || undefined);

    if (!result.ok) {
      return `❌ ${result.message}`;
    }

    return [
      "❌ *تم رفض الإعلان*",
      "",
      `🔖 ${label}`,
      ...(reason ? [`📝 السبب: ${reason}`] : []),
      "",
      "أُبلغ المؤجر بالرفض. ولم تُخصم منه أي أوقية."
    ].join("\n");
  }

  const supabase = getServiceSupabase();

  if (!supabase) {
    return "❌ قاعدة البيانات غير مربوطة.";
  }

  const targetDigits = digitsOf(command.phone);
  const points = command.points;

  const { data: matches } = await supabase
    .from("credit_topups")
    .select("id,phone,status,created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);

  const pending = (matches ?? []).find((row) => digitsOf(String(row.phone)).endsWith(targetDigits));

  if (!pending) {
    return `ما لقيت طلب شحن معلقًا للرقم *${targetDigits}*.\n\nراجع قائمة الطلبات في اللوحة.`;
  }

  const { error: updateError } = await supabase
    .from("credit_topups")
    .update({ status: "approved", points, updated_at: new Date().toISOString() })
    .eq("id", pending.id);

  if (updateError) {
    return `❌ ${updateError.message}`;
  }

  const result = await creditApprovedTopup(String(pending.phone), points);

  if (!result.ok) {
    return `❌ ${result.message}`;
  }

  return [
    "✅ *تم اعتماد الشحن*",
    "",
    `📱 ${String(pending.phone).replace("whatsapp:", "")}`,
    `💼 أضيفت *${points} أوقية*، ورصيده الآن *${result.data?.newBalance} أوقية*.`,
    "",
    "أُبلغ صاحب الرقم، وأُرسل له تلقائيًا أي طلب كان بانتظار الرصيد."
  ].join("\n");
}
