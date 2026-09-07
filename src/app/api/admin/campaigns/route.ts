import { NextResponse } from "next/server";
import { listCampaigns, saveCampaign } from "@/lib/campaigns";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Every campaign, live or paused, newest first. */
export async function GET() {
  const { campaigns, error } = await listCampaigns();

  if (error) {
    return NextResponse.json({ error, campaigns: [] }, { status: 400 });
  }

  return NextResponse.json({ campaigns }, { headers: { "Cache-Control": "no-store" } });
}

/** One campaign written or rewritten. */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    id?: string;
    name?: string;
    keywords?: string;
    replyText?: string;
    videoPath?: string | null;
    active?: boolean;
  };

  const result = await saveCampaign({
    id: body.id,
    name: String(body.name ?? ""),
    keywords: String(body.keywords ?? ""),
    replyText: String(body.replyText ?? ""),
    videoPath: body.videoPath ?? null,
    active: body.active !== false
  });

  if (!result.saved) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
