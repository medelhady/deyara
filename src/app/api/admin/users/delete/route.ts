import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Outcome = { phone: string; deleted: boolean; reason?: string };

/**
 * Removes users, one report line each.
 *
 * Deleting a user is not a tidy operation. The wallet, the whole credit ledger and the conversation
 * history hang off this row with ON DELETE CASCADE, so they go too and cannot be brought back --
 * which is fine for the test numbers this exists to clear out and never fine for someone real.
 *
 * Listings and contact requests do not cascade, so the database would refuse those deletes anyway.
 * They are checked up front so the answer is a sentence about what to do rather than a Postgres
 * foreign key error, and a balance is treated the same way: money on a wallet means the row is
 * somebody's, not leftover test data.
 */
export async function POST(request: Request) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "قاعدة البيانات غير مربوطة." }, { status: 400 });
  }

  const body = (await request.json()) as { phones?: string[] };
  const phones = [...new Set((body.phones ?? []).map((phone) => String(phone)).filter(Boolean))];

  if (phones.length === 0) {
    return NextResponse.json({ error: "لم تحدد أي رقم." }, { status: 400 });
  }

  const [{ data: properties }, { data: asRenter }, { data: asOwner }, { data: wallets }, { data: referred }] =
    await Promise.all([
      supabase.from("properties").select("owner_phone").in("owner_phone", phones),
      supabase.from("contact_requests").select("renter_phone").in("renter_phone", phones),
      supabase.from("contact_requests").select("owner_phone").in("owner_phone", phones),
      supabase.from("user_wallets").select("phone,usage_points,commission_points").in("phone", phones),
      supabase.from("user_wallets").select("referred_by_phone").in("referred_by_phone", phones)
    ]);

  const listingOwners = new Set((properties ?? []).map((row) => String(row.owner_phone)));
  const contacts = new Set([
    ...(asRenter ?? []).map((row) => String(row.renter_phone)),
    ...(asOwner ?? []).map((row) => String(row.owner_phone))
  ]);
  const referrers = new Set((referred ?? []).map((row) => String(row.referred_by_phone)));
  const balances = new Map(
    (wallets ?? []).map((row) => [
      String(row.phone),
      Number(row.usage_points ?? 0) + Number(row.commission_points ?? 0)
    ])
  );

  const results: Outcome[] = [];
  const deletable: string[] = [];

  for (const phone of phones) {
    if (listingOwners.has(phone)) {
      results.push({ phone, deleted: false, reason: "له إعلانات. احذف إعلاناته أولًا من صفحة العقارات." });
      continue;
    }

    if (contacts.has(phone)) {
      results.push({ phone, deleted: false, reason: "مرتبط بطلبات تواصل، وحذفه يفقد سجلها." });
      continue;
    }

    if (referrers.has(phone)) {
      results.push({ phone, deleted: false, reason: "دعا مستخدمين آخرين، وحذفه يقطع سلسلة الإحالات." });
      continue;
    }

    if ((balances.get(phone) ?? 0) > 0) {
      results.push({ phone, deleted: false, reason: "رصيده ليس صفرًا. هذا حساب مستخدم فعلي، وليس رقم تجربة." });
      continue;
    }

    deletable.push(phone);
  }

  if (deletable.length > 0) {
    const { error } = await supabase.from("users").delete().in("phone", deletable);

    if (error) {
      // Anything the checks above did not anticipate still gets said plainly.
      for (const phone of deletable) {
        results.push({ phone, deleted: false, reason: `تعذر الحذف: ${error.message}` });
      }
    } else {
      for (const phone of deletable) {
        results.push({ phone, deleted: true });
      }
    }
  }

  return NextResponse.json({
    deleted: results.filter((result) => result.deleted).length,
    skipped: results.filter((result) => !result.deleted).length,
    results
  });
}
