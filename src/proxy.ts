/**
 * Next 16 proxy (formerly `middleware`).
 *
 * Three responsibilities, in order:
 *   1. Redirect anonymous visits to any /crm path to /login?callbackUrl=…
 *      so we never render the CRM shell without a session (the layout itself
 *      is intentionally permissive — gating belongs here).
 *   2. Force users with `mustChangePassword=true` to /crm/me/change-password
 *      until they pick a new password. The change-password page itself is
 *      exempted so the form can submit successfully.
 *   3. Defer locale handling to next-intl.
 *
 * Auth gating runs BEFORE next-intl so we don't pay for a locale rewrite on
 * a request we're about to redirect anyway.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import createIntlMiddleware from "next-intl/middleware";

import { auth } from "@/lib/auth";
import { routing } from "./i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

// Match /crm and /<locale>/crm — capture the locale (if present) and the
// subpath beneath /crm so we can detect the change-password page.
const CRM_PATH = /^(?:\/(ru|uz))?\/crm(?:\/(.*))?$/;

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const crm = CRM_PATH.exec(pathname);
  if (crm) {
    const subpath = crm[2] ?? "";
    const session = await auth();
    if (!session?.user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?callbackUrl=${encodeURIComponent(
        pathname + request.nextUrl.search,
      )}`;
      return NextResponse.redirect(url);
    }
    if (
      session.user.mustChangePassword &&
      !subpath.startsWith("me/change-password")
    ) {
      const locale = crm[1] ?? "ru";
      const url = request.nextUrl.clone();
      url.pathname =
        locale === "ru"
          ? "/crm/me/change-password"
          : `/${locale}/crm/me/change-password`;
      url.search = "";
      return NextResponse.redirect(url);
    }
  }
  return intlMiddleware(request);
}

export const config = {
  matcher: [
    "/((?!api|_next|_vercel|login|admin|kiosk|tv|receptionist|ticket|c\\/|q\\/|.*\\..*).*)",
  ],
};
