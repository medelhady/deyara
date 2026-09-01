import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { signPropertyMedia } from "@/lib/whatsapp/media";
import { checkVideoUrl } from "@/lib/video-health";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type Row = {
  code: string;
  area: string | null;
  ownerPhone: string;
  ok: boolean;
  reason?: string;
};

/**
 * Answers which listings have a video a renter can actually be shown.
 *
 * A listing whose stored URL has died looks perfectly healthy from every screen: the review page
 * shows a player, the bot offers the video, WhatsApp accepts the send. Only the renter sees the
 * nothing that arrives, and they do not report it -- they leave. This is the one place that asks.
 */
export async function POST() {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "قاعدة البيانات غير مربوطة." }, { status: 400 });
  }

  const { data: properties, error } = await supabase
    .from("properties")
    .select("id,property_code,area,owner_phone")
    .eq("status", "active");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const listings = properties ?? [];

  if (listings.length === 0) {
    return NextResponse.json({ ok: true, checked: 0, broken: [], missing: [] });
  }

  const { data: media } = await supabase
    .from("property_media")
    .select("property_id,storage_url")
    .eq("type", "video")
    .in(
      "property_id",
      listings.map((listing) => listing.id as string)
    );

  const videoByProperty = new Map<string, string>();

  for (const row of media ?? []) {
    videoByProperty.set(String(row.property_id), String(row.storage_url ?? ""));
  }

  const broken: Row[] = [];
  const missing: Row[] = [];

  // Sequential on purpose: this walks every active listing, and firing fifty requests at storage at
  // once is a good way to be rate limited into a false "broken" verdict.
  for (const listing of listings) {
    const describe: Row = {
      code: (listing.property_code as string | null) ?? String(listing.id).slice(0, 8),
      area: (listing.area as string | null) ?? null,
      ownerPhone: String(listing.owner_phone ?? "").replace("whatsapp:", ""),
      ok: false
    };

    const stored = videoByProperty.get(String(listing.id));

    if (!stored) {
      missing.push({ ...describe, reason: "لا يوجد فيديو محفوظ لهذا الإعلان." });
      continue;
    }

    const signed = await signPropertyMedia(stored);

    if (!signed) {
      broken.push({ ...describe, reason: "تعذّر توقيع رابط الملف — غالبًا حُذف من التخزين." });
      continue;
    }

    const health = await checkVideoUrl(signed);

    if (!health.ok) {
      broken.push({ ...describe, reason: health.reason });
    }
  }

  return NextResponse.json({
    ok: true,
    checked: listings.length,
    broken,
    missing
  });
}
