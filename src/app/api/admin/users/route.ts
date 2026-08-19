import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ users: [], mode: "mock" });
  }

  const { data: users, error } = await supabase
    .from("users")
    .select("phone,role,created_at,blocked_at,blocked_reason")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const phones = (users ?? []).map((user) => user.phone as string);

  // Counting per user in a loop would be one query each, so read the two columns once and tally.
  const [{ data: properties }, { data: contactRequests }] = await Promise.all([
    supabase.from("properties").select("owner_phone").in("owner_phone", phones),
    supabase.from("contact_requests").select("renter_phone").in("renter_phone", phones)
  ]);

  const listingCounts = new Map<string, number>();
  const contactCounts = new Map<string, number>();

  for (const row of properties ?? []) {
    const phone = row.owner_phone as string;
    listingCounts.set(phone, (listingCounts.get(phone) ?? 0) + 1);
  }

  for (const row of contactRequests ?? []) {
    const phone = row.renter_phone as string;
    contactCounts.set(phone, (contactCounts.get(phone) ?? 0) + 1);
  }

  return NextResponse.json(
    {
      users: (users ?? []).map((user) => ({
        ...user,
        listings_count: listingCounts.get(user.phone as string) ?? 0,
        contact_requests_count: contactCounts.get(user.phone as string) ?? 0
      }))
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}
