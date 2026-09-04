import { NextRequest, NextResponse } from "next/server";
import { getSessionSecret, sessionCookieName, verifySessionToken } from "@/lib/admin-auth";

const publicAdminPaths = ["/admin/login", "/api/admin/login"];

function deny(request: NextRequest, protectsAdminApi: boolean) {
  if (protectsAdminApi) {
    /**
     * Said in the language of whoever reads it, and with the way out.
     *
     * A page open past the twelve-hour session showed a bare "Unauthorized" in a red box: an admin
     * who cannot read it has no way to tell an expired login from a broken dashboard, and the two
     * call for very different reactions.
     */
    return NextResponse.json(
      { error: "انتهت جلستك. سجّل الدخول من جديد للمتابعة.", code: "session_expired" },
      { status: 401 }
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/admin/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const protectsAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
  const protectsAdminApi = pathname.startsWith("/api/admin/");

  if (!protectsAdminPage && !protectsAdminApi) {
    return NextResponse.next();
  }

  if (publicAdminPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const secret = getSessionSecret();

  // Missing configuration used to open the dashboard to everyone. Refuse instead: an admin locked
  // out of their own panel is a bad afternoon, while an open panel leaks every owner's phone number.
  // Local development keeps the old permissive behaviour so the panel still runs without setup.
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("ADMIN_SESSION_SECRET and ADMIN_ACCESS_TOKEN are both unset: refusing admin access.");
      return deny(request, protectsAdminApi);
    }

    return NextResponse.next();
  }

  const cookie = request.cookies.get(sessionCookieName)?.value;

  if (await verifySessionToken(cookie)) {
    return NextResponse.next();
  }

  // Accepts a session issued before per-person logins existed, so nobody is signed out by the
  // deploy that introduces them. Remove once every admin has an account.
  if (cookie && process.env.ADMIN_ACCESS_TOKEN?.trim() && cookie === process.env.ADMIN_ACCESS_TOKEN.trim()) {
    return NextResponse.next();
  }

  return deny(request, protectsAdminApi);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"]
};
