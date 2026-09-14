import { NextResponse } from "next/server";
import { listOffices, saveOffice } from "@/lib/offices";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Every office collected so far, newest first. */
export async function GET() {
  const { offices, error } = await listOffices();

  if (error) {
    return NextResponse.json({ error, offices: [] }, { status: 400 });
  }

  return NextResponse.json({ offices }, { headers: { "Cache-Control": "no-store" } });
}

/** One office, as corrected by the admin -- never as the reader returned it. */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    id?: string;
    name?: string;
    phones?: string[];
    platform?: string;
    note?: string;
    screenshotPath?: string | null;
  };

  const result = await saveOffice({
    id: body.id,
    name: String(body.name ?? ""),
    phones: Array.isArray(body.phones) ? body.phones : [],
    platform: String(body.platform ?? ""),
    note: String(body.note ?? ""),
    screenshotPath: body.screenshotPath ?? null
  });

  if (!result.saved) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
