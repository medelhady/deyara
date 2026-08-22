import { NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/admin/login", request.url), 303);
  response.cookies.delete(sessionCookieName);

  return response;
}
