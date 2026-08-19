import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ConversationRow = {
  id: string;
  phone: string;
  direction: string;
  message_type: string;
  body: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ threads: [], messages: [], mode: "mock" });
  }

  const phone = new URL(request.url).searchParams.get("phone");

  // One conversation asked for by number: the whole exchange, oldest first, like a chat.
  if (phone) {
    const { data, error } = await supabase
      .from("conversations")
      .select("id,phone,direction,message_type,body,created_at")
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      { messages: ((data ?? []) as ConversationRow[]).reverse() },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  }

  // Otherwise the thread list. Grouping in SQL would need a view, so read the recent tail and fold
  // it by number, which is enough to show who has been talking and when.
  const { data, error } = await supabase
    .from("conversations")
    .select("id,phone,direction,message_type,body,created_at")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const threads = new Map<
    string,
    { phone: string; lastMessage: string; lastDirection: string; lastAt: string; count: number }
  >();

  for (const row of (data ?? []) as ConversationRow[]) {
    const existing = threads.get(row.phone);

    if (existing) {
      existing.count += 1;
      continue;
    }

    threads.set(row.phone, {
      phone: row.phone,
      lastMessage: row.body?.trim() || `(${row.message_type})`,
      lastDirection: row.direction,
      lastAt: row.created_at,
      count: 1
    });
  }

  return NextResponse.json(
    { threads: Array.from(threads.values()) },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}
