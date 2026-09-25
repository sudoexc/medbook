/**
 * Next 16 proxy (formerly `middleware`).
 *
 * Staff surfaces are /crm and the doctor cabinet /doctor (each optionally
 * under /ru or /uz). For both, in order:
 *   1. Resolve the session. `auth()` runs the NextAuth `jwt` callback, which
 *      asks `src/server/auth/session-guard.ts` whether the server-side
 *      UserSession is still alive (idle timeout, 8h cap, one session per user,
 *      not revoked) and whether the account is still active. Any "no" comes
 *      back as no session: redirect to /login?callbackUrl=… and drop the dead
 *      cookies, so Back / a bookmark cannot walk into the CRM again.
 *      (Audit SEC-06: this used to be checked here, for /crm only, and only
 *      when the `crm_user_session` cookie happened to arrive.)
 *   2. Force users with `mustChangePassword=true` to their change-password
 *      page until they pick a new password.
 *   3. Mandatory TOTP enrolment: ADMIN/SUPER_ADMIN, plus every staff role
 *      when the clinic has require2faForAll, must enrol before using any
 *      staff page.
 *   4. Defer locale handling to next-intl.
 *
 * Steps 2 and 3 send a doctor to /doctor/me/… and everyone else to /crm/me/…
 * The CRM layout bounces doctors into their cabinet, so before DC-02 a doctor
 * could reach neither page: a temporary password could not be changed, and
 * «2FA for everyone» left the cabinet dead on 403 MFA_REQUIRED.
 *
 * Auth gating runs BEFORE next-intl so we don't pay for a locale rewrite on
 * a request we're about to redirect anyway.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import createIntlMiddleware from "next-intl/middleware";

import { auth } from "@/lib/auth";
import { routing } from "./i18n/routing";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { SESSION_COOKIE_NAME } from "@/server/auth/user-session";
import { requiresTotpEnrollment } from "@/server/auth/security-policy";
import {
  CHANGE_PASSWORD_SUBPATH,
  SECURITY_ENROL_SUBPATH,
  forcedAccountRedirect,
  isExemptFromForcedRedirect,
  parseStaffPath,
} from "@/server/auth/staff-redirects";
import type { Role } from "@/lib/tenant-context";

const intlMiddleware = createIntlMiddleware(routing);

// NextAuth's JWT cookie (plain on http, __Secure- on https, split into
// .0/.1… chunks when large).
const AUTH_COOKIE = /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/;

function buildLoginUrl(request: NextRequest, callback: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  const params = new URLSearchParams();
  params.set("callbackUrl", callback);
  url.search = `?${params.toString()}`;
  return url;
}

function buildStaffRedirect(
  request: NextRequest,
  locale: string,
  target: string,
) {
  const url = request.nextUrl.clone();
  // `target` is the path under the locale, e.g. "doctor/me/security".
  url.pathname = locale === "ru" ? `/${target}` : `/${locale}/${target}`;
  url.search = "";
  return url;
}

/** Expire whatever session cookies a logged-out browser still carries. */
function clearDeadSessionCookies(request: NextRequest, res: NextResponse) {
  const secure = process.env.NODE_ENV === "production";
  for (const c of request.cookies.getAll()) {
    if (c.name === SESSION_COOKIE_NAME || AUTH_COOKIE.test(c.name)) {
      res.cookies.set(c.name, "", {
        httpOnly: true,
        secure: secure || c.name.startsWith("__Secure-"),
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
    }
  }
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const staff = parseStaffPath(pathname);
  if (staff) {
    const session = await auth();
    if (!session?.user) {
      const res = NextResponse.redirect(
        buildLoginUrl(request, pathname + request.nextUrl.search),
      );
      clearDeadSessionCookies(request, res);
      return res;
    }

    // 3. Phase 17 Wave 2 — mandatory TOTP enrolment. Only looked up when it
    // can matter: not on the account pages themselves, and not while a
    // password change is pending (that redirect wins).
    let owesTotpEnrolment = false;
    if (
      !session.user.mustChangePassword &&
      !isExemptFromForcedRedirect(staff.subpath, [
        SECURITY_ENROL_SUBPATH,
        CHANGE_PASSWORD_SUBPATH,
      ])
    ) {
      try {
        const me = await runWithTenant({ kind: "SYSTEM" }, () =>
          prisma.user.findUnique({
            where: { id: session.user.id },
            select: {
              totpEnabledAt: true,
              role: true,
              clinic: { select: { require2faForAll: true } },
            },
          }),
        );
        if (me) {
          owesTotpEnrolment =
            requiresTotpEnrollment({
              role: me.role as Role,
              clinicRequire2faForAll: me.clinic?.require2faForAll ?? false,
            }) && !me.totpEnabledAt;
        }
      } catch {
        // DB blip — let the request through; the next hit retries.
      }
    }

    // 2 + 3. mustChangePassword (Phase 11 / #190; the claim is fresh, the jwt
    // callback re-reads it from the database) and TOTP enrolment.
    const forced = forcedAccountRedirect({
      subpath: staff.subpath,
      role: session.user.role,
      mustChangePassword: session.user.mustChangePassword,
      owesTotpEnrolment,
    });
    if (forced) {
      return NextResponse.redirect(
        buildStaffRedirect(request, staff.locale, forced.target),
      );
    }
  }
  return intlMiddleware(request);
}

export const config = {
  matcher: [
    "/((?!api|_next|_vercel|login|admin|kiosk|tv|receptionist|ticket|c\\/|q\\/|.*\\..*).*)",
  ],
};
