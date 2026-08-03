import { NextRequest, NextResponse } from "next/server";

const publicAdminPaths = ["/admin/login", "/api/admin/login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const protectsAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
  const protectsAdminApi = pathname.startsWith("/api/admin/");

  if (!protectsAdminPage && !protectsAdminApi) {
    return NextResponse.next();
  }

  if (publicAdminPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const expectedToken = process.env.ADMIN_ACCESS_TOKEN?.trim();

  if (!expectedToken) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get("deyara_admin")?.value;

  if (sessionToken === expectedToken) {
    return NextResponse.next();
  }

  if (protectsAdminApi) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/admin/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"]
};
