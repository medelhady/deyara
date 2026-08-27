import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Outcome = {
  phone: string;
  deleted: boolean;
  reason?: string;
  blockedByContacts?: number;
  blockedByMentions?: number;
};

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

  /**
   * `force` drops only the contact-request guard, and only when the admin has been shown how many
   * records it would destroy. The other guards stay: listings can be deleted from their own page, a
   * balance means the account is somebody's, and cutting a referral chain loses a marketer's work.
   */
  const body = (await request.json()) as { phones?: string[]; force?: boolean };
  const force = body.force === true;
  const phones = [...new Set((body.phones ?? []).map((phone) => String(phone)).filter(Boolean))];

  if (phones.length === 0) {
    return NextResponse.json({ error: "لم تحدد أي رقم." }, { status: 400 });
  }

  const [
    { data: properties },
    { data: asRenter },
    { data: asOwner },
    { data: wallets },
    { data: referred },
    { data: mentioned }
  ] = await Promise.all([
      supabase.from("properties").select("owner_phone,property_code,id").in("owner_phone", phones),
      supabase.from("contact_requests").select("renter_phone").in("renter_phone", phones),
      supabase.from("contact_requests").select("owner_phone").in("owner_phone", phones),
      supabase.from("user_wallets").select("phone,usage_points,commission_points").in("phone", phones),
      supabase.from("user_wallets").select("referred_by_phone").in("referred_by_phone", phones),
      // Ledger rows belonging to other people that merely name this one, e.g. the commission row on
      // a marketer's account that records who it came from.
      supabase.from("credit_transactions").select("related_phone").in("related_phone", phones)
    ]);

  // Kept per owner rather than as a set of phones: naming the listings is the difference between an
  // admin knowing what to delete and hunting for it.
  const listingsByOwner = new Map<string, string[]>();

  for (const row of properties ?? []) {
    const owner = String(row.owner_phone);
    const code = String(row.property_code ?? String(row.id).slice(0, 8));

    listingsByOwner.set(owner, [...(listingsByOwner.get(owner) ?? []), code]);
  }
  // Counted per phone so the refusal can say how many records dropping the guard would destroy.
  const contactCounts = new Map<string, number>();

  for (const phone of [
    ...(asRenter ?? []).map((row) => String(row.renter_phone)),
    ...(asOwner ?? []).map((row) => String(row.owner_phone))
  ]) {
    contactCounts.set(phone, (contactCounts.get(phone) ?? 0) + 1);
  }
  const referrers = new Set((referred ?? []).map((row) => String(row.referred_by_phone)));

  const mentionCounts = new Map<string, number>();

  for (const row of mentioned ?? []) {
    const phone = String(row.related_phone);
    mentionCounts.set(phone, (mentionCounts.get(phone) ?? 0) + 1);
  }
  const balances = new Map(
    (wallets ?? []).map((row) => [
      String(row.phone),
      Number(row.usage_points ?? 0) + Number(row.commission_points ?? 0)
    ])
  );

  const results: Outcome[] = [];
  const deletable: string[] = [];

  for (const phone of phones) {
    const listings = listingsByOwner.get(phone);

    if (listings && listings.length > 0) {
      results.push({
        phone,
        deleted: false,
        reason: `له ${listings.length} إعلان (${listings.join("، ")}). ابحث برقمه في صفحة العقارات، افتح كل إعلان، واضغط «حذف نهائي».`
      });
      continue;
    }

    const contactCount = contactCounts.get(phone) ?? 0;

    if (contactCount > 0 && !force) {
      results.push({
        phone,
        deleted: false,
        blockedByContacts: contactCount,
        reason: `مرتبط بـ ${contactCount} طلب تواصل مدفوع. الحذف يمحو سجلها نهائيًا.`
      });
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

    const mentions = mentionCounts.get(phone) ?? 0;

    if (mentions > 0 && !force) {
      results.push({
        phone,
        deleted: false,
        blockedByContacts: 0,
        blockedByMentions: mentions,
        reason: `مذكور في ${mentions} حركة مالية تخص مستخدمين آخرين. الحذف يزيل ذكره منها دون حذفها.`
      });
      continue;
    }

    deletable.push(phone);
  }

  if (deletable.length > 0) {
    // contact_requests has no cascade onto users, so the rows have to go first or the delete is
    // refused by the database. Only reached with force, which the admin confirmed against a count.
    if (force) {
      await supabase.from("contact_requests").delete().in("renter_phone", deletable);
      await supabase.from("contact_requests").delete().in("owner_phone", deletable);

      // Cleared, not deleted. These rows belong to other people -- a marketer's commission, say --
      // and related_phone only records who it came from. Nulling it drops the reference the
      // foreign key is protecting while the money record itself survives.
      await supabase
        .from("credit_transactions")
        .update({ related_phone: null })
        .in("related_phone", deletable);
    }

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
