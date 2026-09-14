import { NextResponse } from "next/server";
import { listOffices, saveOffice } from "@/lib/offices";
import { getActiveAreas } from "@/lib/conversation/engine";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Every office collected so far, newest first. */
export async function GET() {
  const { offices, error } = await listOffices();

  if (error) {
    return NextResponse.json({ error, offices: [] }, { status: 400 });
  }

  // The districts the bot already knows, so the form offers them instead of inviting five
  // spellings of the same place.
  return NextResponse.json(
    { offices, areas: await getActiveAreas() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** One office, as corrected by the admin -- never as the reader returned it. */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    id?: string;
    name?: string;
    phones?: string[];
    platform?: string;
    area?: string;
    note?: string;
    screenshotPath?: string | null;
  };

  const result = await saveOffice({
    id: body.id,
    name: String(body.name ?? ""),
    phones: Array.isArray(body.phones) ? body.phones : [],
    platform: String(body.platform ?? ""),
    area: String(body.area ?? ""),
    note: String(body.note ?? ""),
    // Undefined and null mean different things here: no picture supplied versus remove the one
    // stored. An edit from the table sends neither, and must not erase it.
    screenshotPath: "screenshotPath" in body ? (body.screenshotPath ?? null) : undefined
  });

  if (!result.saved) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
