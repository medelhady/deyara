import { NextResponse } from "next/server";
import { deleteOffice } from "@/lib/offices";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const result = await deleteOffice(params.id);

  if (!result.deleted) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
