import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { signPropertyMedia } from "@/lib/whatsapp/media";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({
      properties: [],
      mode: "mock",
      message: "Add Supabase environment variables to read live properties."
    });
  }

  const { count } = await supabase
    .from("properties")
    .select("*", { count: "exact", head: true });

  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The listing video lives in property_media, and the bucket is private, so each file needs a
  // signed link before an admin can play it.
  const propertyIds = (data ?? []).map((property) => property.id as string);
  const { data: mediaRows, error: mediaError } = propertyIds.length
    ? await supabase
        .from("property_media")
        .select("property_id,type,storage_url,content_type")
        .in("property_id", propertyIds)
    : { data: [], error: null };

  if (mediaError) {
    console.error("Failed to read property media", mediaError);
  }

  const mediaByProperty = new Map<string, Array<{ type: string; url: string | null; contentType: string | null }>>();

  await Promise.all(
    (mediaRows ?? []).map(async (row) => {
      const url = await signPropertyMedia(row.storage_url as string);
      const list = mediaByProperty.get(row.property_id as string) ?? [];
      list.push({ type: row.type as string, url, contentType: (row.content_type as string) ?? null });
      mediaByProperty.set(row.property_id as string, list);
    })
  );

  const properties = (data ?? []).map((property) => ({
    ...property,
    media: mediaByProperty.get(property.id as string) ?? []
  }));

  return NextResponse.json(
    {
      properties,
      debug: {
        count,
        urlHost: process.env.NEXT_PUBLIC_SUPABASE_URL
          ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
          : null
      }
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
      }
    }
  );
}
