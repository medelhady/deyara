import { NextResponse } from "next/server";
import { createSessionToken, sessionCookieName, sessionCookieOptions } from "@/lib/admin-auth";
import { hasNoAccounts, signIn } from "@/lib/dashboard-accounts";

export const dynamic = "force-dynamic";

function backToLogin(request: Request, phone: string, error: string) {
  const url = new URL("/admin/login", request.url);
  url.searchParams.set("error", error);

  // Keep the number filled in so only the password has to be retyped.
  if (phone) {
    url.searchParams.set("phone", phone);
  }

  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const result = await signIn(phone, password);
  let name = result.ok ? result.name : "";
  let signedInPhone = result.ok ? result.phone : "";

  if (!result.ok) {
    /**
     * Bootstrap: before anyone has an account, ADMIN_ACCESS_TOKEN works as the password so the
     * first person can get in and create the real accounts. It stops working the moment one
     * account exists, so this is not a standing back door.
     */
    const masterKey = process.env.ADMIN_ACCESS_TOKEN?.trim();
    const bootstrapping = Boolean(masterKey) && password === masterKey && (await hasNoAccounts());

    if (!bootstrapping) {
      return backToLogin(request, phone, result.error);
    }

    name = "الحساب الأول";
    signedInPhone = phone;
  }

  const response = NextResponse.redirect(new URL("/admin", request.url), 303);
  response.cookies.set(sessionCookieName, await createSessionToken(signedInPhone, name), sessionCookieOptions);

  return response;
}
