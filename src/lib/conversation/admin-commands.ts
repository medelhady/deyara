import { getServiceSupabase } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { creditApprovedTopup, setPropertyStatus } from "@/lib/admin-actions";

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
  "📌 هذه الأوامر تعمل من أرقام الإدارة فقط."
].join("\n");

/**
 * Handles an admin instruction sent over WhatsApp. Returns null when the message is not a command,
 * so an admin can still use the bot as a renter or an owner with the same number.
 */
export async function handleAdminCommand(phone: string, body: string): Promise<string | null> {
  const text = body.trim();

  if (!text) {
    return null;
  }

  if (/^(اوامر|أوامر|اوامر الادارة|مساعدة الادارة)$/i.test(text)) {
    return (await isAdminPhone(phone)) ? helpMessage : null;
  }

  const approve = text.match(/^(?:قبول|موافقة|اعتماد)\s+(\S+)\s*$/);
  const reject = text.match(/^(?:رفض)\s+(\S+)\s*(.*)$/);
  const topup = text.match(/^(?:شحن|اضافة نقاط|إضافة نقاط)\s+(\+?[\d\s]+?)\s+(\d{1,7})\s*$/);

  if (!approve && !reject && !topup) {
    return null;
  }

  if (!(await isAdminPhone(phone))) {
    // Say nothing: a normal user typing "رفض" should fall through to the usual conversation.
    return null;
  }

  if (approve) {
    const property = await findProperty(approve[1]);

    if (!property) {
      return `ما لقيت إعلانًا برقم *${approve[1]}*.\n\nتأكد من رقم الإعلان كما يظهر في اللوحة.`;
    }

    const result = await setPropertyStatus(String(property.id), "active");

    if (!result.ok) {
      return `❌ ${result.message}`;
    }

    const spent = result.data?.spentPoints as number | undefined;

    return [
      "✅ *تم نشر الإعلان*",
      "",
      `🔖 ${property.property_code ?? String(property.id).slice(0, 8)}`,
      `🏠 ${property.type ?? "دار"} في ${property.area ?? "منطقة غير محددة"}`,
      ...(spent ? ["", `تم خصم *${spent} نقطة* من المؤجر وأُبلغ بالنشر.`] : ["", "أُبلغ المؤجر بالنشر."])
    ].join("\n");
  }

  if (reject) {
    const property = await findProperty(reject[1]);

    if (!property) {
      return `ما لقيت إعلانًا برقم *${reject[1]}*.\n\nتأكد من رقم الإعلان كما يظهر في اللوحة.`;
    }

    const reason = reject[2]?.trim();
    const result = await setPropertyStatus(String(property.id), "rejected", reason || undefined);

    if (!result.ok) {
      return `❌ ${result.message}`;
    }

    return [
      "❌ *تم رفض الإعلان*",
      "",
      `🔖 ${property.property_code ?? String(property.id).slice(0, 8)}`,
      ...(reason ? [`📝 السبب: ${reason}`] : []),
      "",
      "أُبلغ المؤجر بالرفض. ولم تُخصم منه أي نقطة."
    ].join("\n");
  }

  const supabase = getServiceSupabase();

  if (!supabase) {
    return "❌ قاعدة البيانات غير مربوطة.";
  }

  const targetDigits = digitsOf(topup![1]);
  const points = Number(topup![2]);

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
    `💼 أضيفت *${points} نقطة*، ورصيده الآن *${result.data?.newBalance} نقطة*.`,
    "",
    "أُبلغ صاحب الرقم، وأُرسل له تلقائيًا أي طلب كان بانتظار الرصيد."
  ].join("\n");
}
