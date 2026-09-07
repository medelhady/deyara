import { NextResponse } from "next/server";
import { deleteCampaign } from "@/lib/campaigns";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Removes one campaign. Pausing it is the reversible option, and the page offers that first. */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const result = await deleteCampaign(params.id);

  if (!result.deleted) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
