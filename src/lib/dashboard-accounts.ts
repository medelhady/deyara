import { getServiceSupabase } from "@/lib/supabase/server";
import { hashPassword, normalizePhone, verifyPassword } from "@/lib/admin-auth";

export type DashboardAccount = {
  id: string;
  phone: string;
  name: string;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  last_login_at: string | null;
};

export const minimumPasswordLength = 8;

// The migration ships as a file an admin runs by hand, so "table not found" is the likely first
// failure. Say what to do about it rather than forwarding a PostgREST code.
export const missingTableMessage =
  "جدول حسابات الدخول dashboard_accounts غير موجود. شغّل ملف supabase/add-dashboard-accounts.sql في محرر SQL بـ Supabase ثم أعد المحاولة.";

function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) {
    return false;
  }

  return error.code === "PGRST205" || (error.message ?? "").includes("dashboard_accounts");
}

export type AccountsResult =
  | { ok: true; accounts: DashboardAccount[] }
  | { ok: false; error: string; missingTable?: boolean };

export async function listAccounts(): Promise<AccountsResult> {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { ok: false, error: "قاعدة البيانات غير مربوطة." };
  }

  const { data, error } = await supabase
    .from("dashboard_accounts")
    .select("id,phone,name,is_active,created_at,created_by,last_login_at")
    .order("created_at", { ascending: true });

  if (error) {
    return {
      ok: false,
      error: isMissingTable(error) ? missingTableMessage : error.message,
      missingTable: isMissingTable(error)
    };
  }

  return { ok: true, accounts: (data ?? []) as DashboardAccount[] };
}

export type CreateAccountResult = { ok: true; account: DashboardAccount } | { ok: false; error: string };

export async function createAccount(input: {
  phone: string;
  name: string;
  password: string;
  createdBy: string | null;
}): Promise<CreateAccountResult> {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { ok: false, error: "قاعدة البيانات غير مربوطة." };
  }

  const phone = normalizePhone(input.phone);

  if (phone.length < 8) {
    return { ok: false, error: "اكتب رقم الهاتف بصيغة دولية كاملة مع رمز الدولة." };
  }

  if (input.password.length < minimumPasswordLength) {
    return { ok: false, error: `الرقم السري لا يقل عن ${minimumPasswordLength} خانات.` };
  }

  const { data, error } = await supabase
    .from("dashboard_accounts")
    .insert({
      phone,
      name: input.name.trim(),
      password_hash: await hashPassword(input.password),
      created_by: input.createdBy
    })
    .select("id,phone,name,is_active,created_at,created_by,last_login_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "هذا الرقم له حساب دخول بالفعل." };
    }

    return { ok: false, error: isMissingTable(error) ? missingTableMessage : error.message };
  }

  return { ok: true, account: data as DashboardAccount };
}

export async function setAccountActive(id: string, isActive: boolean) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { ok: false as const, error: "قاعدة البيانات غير مربوطة." };
  }

  const { error } = await supabase.from("dashboard_accounts").update({ is_active: isActive }).eq("id", id);

  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function changeAccountPassword(id: string, password: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { ok: false as const, error: "قاعدة البيانات غير مربوطة." };
  }

  if (password.length < minimumPasswordLength) {
    return { ok: false as const, error: `الرقم السري لا يقل عن ${minimumPasswordLength} خانات.` };
  }

  const { error } = await supabase
    .from("dashboard_accounts")
    .update({ password_hash: await hashPassword(password) })
    .eq("id", id);

  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function deleteAccount(id: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { ok: false as const, error: "قاعدة البيانات غير مربوطة." };
  }

  const { error } = await supabase.from("dashboard_accounts").delete().eq("id", id);

  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export type SignInResult =
  | { ok: true; phone: string; name: string }
  | { ok: false; reason: "invalid" | "inactive" | "unavailable"; error: string };

/**
 * Checks a phone and password against the accounts table.
 *
 * A wrong password and an unknown number return the same message on purpose: telling a stranger
 * which numbers have accounts is a free list of who to attack.
 */
export async function signIn(phoneInput: string, password: string): Promise<SignInResult> {
  const supabase = getServiceSupabase();
  const invalid = { ok: false as const, reason: "invalid" as const, error: "رقم الهاتف أو الرقم السري غير صحيح." };

  if (!supabase) {
    return { ok: false, reason: "unavailable", error: "قاعدة البيانات غير مربوطة." };
  }

  const phone = normalizePhone(phoneInput);

  if (!phone || !password) {
    return invalid;
  }

  const { data, error } = await supabase
    .from("dashboard_accounts")
    .select("id,phone,name,password_hash,is_active")
    .eq("phone", phone)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      reason: "unavailable",
      error: isMissingTable(error) ? missingTableMessage : error.message
    };
  }

  if (!data) {
    return invalid;
  }

  if (!(await verifyPassword(password, String(data.password_hash)))) {
    return invalid;
  }

  if (!data.is_active) {
    return { ok: false, reason: "inactive", error: "هذا الحساب موقوف. راجع الإدارة." };
  }

  await supabase
    .from("dashboard_accounts")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", data.id);

  return { ok: true, phone: String(data.phone), name: String(data.name ?? "") };
}

/**
 * True when nobody has an account yet, which is what allows the bootstrap login described in the
 * login route.
 *
 * A missing table counts as "no accounts": nobody can hold an account in a table that does not
 * exist, and answering false there would lock the first admin out of the panel they need in order
 * to notice the migration has not been run. Every other read failure answers false, so a transient
 * error cannot re-open the bootstrap door once real accounts exist.
 */
export async function hasNoAccounts() {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return false;
  }

  const { count, error } = await supabase
    .from("dashboard_accounts")
    .select("id", { count: "exact", head: true });

  if (error) {
    return isMissingTable(error);
  }

  return (count ?? 0) === 0;
}
