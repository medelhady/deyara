import { NextResponse } from "next/server";
import { z } from "zod";
import { setPropertyStatus } from "@/lib/admin-actions";

export const dynamic = "force-dynamic";

const statusSchema = z.object({
  status: z.enum(["active", "rejected", "hidden", "rented"]),
  admin_note: z.string().optional()
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const payload = statusSchema.parse(await request.json());
  const result = await setPropertyStatus(params.id, payload.status, payload.admin_note);

  if (!result.ok) {
    const status =
      result.reason === "unavailable" ? 503 : result.reason === "not_found" ? 404 : result.reason === "insufficient_points" ? 409 : 500;

    return NextResponse.json({ error: result.message, reason: result.reason }, { status });
  }

  return NextResponse.json({ property: result.data?.property });
}
