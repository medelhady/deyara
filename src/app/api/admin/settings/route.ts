import { NextResponse } from "next/server";
import { z } from "zod";
import { isSettingsTableMissing, missingTableMessage, readSettingRows, saveSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const settings = await readSettingRows();

  return NextResponse.json(
    { settings, warning: isSettingsTableMissing() ? missingTableMessage : null },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}

const updateSchema = z.record(z.string(), z.union([z.string(), z.number()]));

export async function PATCH(request: Request) {
  const payload = updateSchema.parse(await request.json());
  const updates = Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, String(value)])
  );

  const result = await saveSettings(updates);

  if (!result.saved) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ settings: await readSettingRows() });
}
