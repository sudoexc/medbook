/**
 * Next 16 proxy (formerly `middleware`).
 *
 * Responsibilities, in order:
 *   1. Redirect anonymous visits to any /crm path to /login?callbackUrl=…
 *      so we never render the CRM shell without a session (the layout itself
 *      is intentionally permissive — gating belongs here).
 *   2. Phase 17 Wave 2 — UserSession lifetime enforcement: idle timeout +
 *      8h forced re-rotation. A session whose row is missing or which
 *      tripped either bound is killed (cookie cleared, redirect to
 *      /login?reason=…). lastActivityAt is bumped on every authenticated
 *      hit so a busy user never trips idle.
 *   3. Phase 17 Wave 2 — mandatory TOTP redirect: ADMIN/SUPER_ADMIN, plus
 *      every staff role when the clinic has require2faForAll, must enrol
 *      before they can use any /crm path. The /crm/me/security page is
 *      whitelisted so the form can submit successfully.
 *   4. Force users with `mustChangePassword=true` to /crm/me/change-password
 *      until they pick a new password.
 *   5. Defer locale handling to next-intl.
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
import {
  SESSION_COOKIE_NAME,
  hashSessionToken,
} from "@/server/auth/user-session";
import {
  checkSessionLifetime,
  IDLE_TIMEOUT_DEFAULT,
} from "@/server/auth/session-security";
import { requiresTotpEnrollment } from "@/server/auth/security-policy";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import type { Role } from "@/lib/tenant-context";

const intlMiddleware = createIntlMiddleware(routing);

// Match /crm and /<locale>/crm — capture the locale (if present) and the
// subpath beneath /crm so we can detect the gate-exempt pages.
const CRM_PATH = /^(?:\/(ru|uz))?\/crm(?:\/(.*))?$/;

// CRM subpaths that the proxy must NOT loop on. The user is allowed to
// visit these even while a forced redirect is pending — otherwise the form
// can't be submitted.
const CHANGE_PASSWORD_SUBPATH = "me/change-password";
const SECURITY_ENROL_SUBPATHS = ["me/security"];

function isExemptFromForcedRedirect(subpath: string, exemptList: string[]) {
  return exemptList.some((p) => subpath === p || subpath.startsWith(`${p}/`));
}

function buildLoginUrl(
  request: NextRequest,
  reason: "idle" | "forced-rerotate" | "expired" | null,
  callback: string,
) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  const params = new URLSearchParams();
  params.set("callbackUrl", callback);
  if (reason) params.set("reason", reason);
  url.search = `?${params.toString()}`;
  return url;
}

function buildCrmRedirect(
  request: NextRequest,
  locale: string,
  subpath: string,
) {
  const url = request.nextUrl.clone();
  url.pathname =
    locale === "ru" ? `/${subpath}` : `/${locale}/${subpath}`;
  // Note: `${subpath}` here is the absolute target including the `crm/`
  // prefix.
  url.search = "";
  return url;
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const crm = CRM_PATH.exec(pathname);
  if (crm) {
    const locale = crm[1] ?? "ru";
    const subpath = crm[2] ?? "";
    const session = await auth();
    if (!session?.user) {
      const url = buildLoginUrl(
        request,
        null,
        pathname + request.nextUrl.search,
      );
      return NextResponse.redirect(url);
    }

    // 2. UserSession lifetime check. We hash the cookie and look the row
    // up under SYSTEM context (UserSession lives outside the tenant
    // extension allowlist). A missing row → treat as logged out (the
    // cookie likely belongs to a kicked / re-rotated session).
    const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
    let kickReason: "idle" | "forced-rerotate" | "expired" | null = null;
    let killedSessionId: string | null = null;
    let bumpSessionId: string | null = null;
    if (cookieValue) {
      const tokenHash = hashSessionToken(cookieValue);
      try {
        const row = await runWithTenant({ kind: "SYSTEM" }, () =>
          prisma.userSession.findUnique({
            where: { tokenHash },
            select: {
              id: true,
              userId: true,
              clinicId: true,
              createdAt: true,
              lastActivityAt: true,
              user: {
                select: {
                  lastSessionRotatedAt: true,
                  clinic: {
                    select: { sessionIdleTimeoutMinutes: true },
                  },
                },
              },
            },
          }),
        );
        if (!row) {
          kickReason = "expired";
        } else {
          const idle =
            row.user.clinic?.sessionIdleTimeoutMinutes ?? IDLE_TIMEOUT_DEFAULT;
          const verdict = checkSessionLifetime({
            lastActivityAt: row.lastActivityAt,
            lastSessionRotatedAt: row.user.lastSessionRotatedAt,
            sessionCreatedAt: row.createdAt,
            idleTimeoutMinutes: idle,
          });
          if (verdict) {
            kickReason = verdict;
            killedSessionId = row.id;
          } else {
            bumpSessionId = row.id;
          }
        }
      } catch {
        // DB unreachable — fail open on the lifetime check rather than
        // locking everyone out. Auth itself still gates the request.
      }
    } else {
      // No UserSession cookie at all — the JWT alone is not enough;
      // sessions minted before Wave 2 (legacy) get a one-time pass: the
      // proxy treats them as alive. New logins always set the cookie.
    }

    if (kickReason) {
      const res = NextResponse.redirect(
        buildLoginUrl(request, kickReason, pathname + request.nextUrl.search),
      );
      res.cookies.set(SESSION_COOKIE_NAME, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
      // Best-effort: drop the dead row + emit an audit. Both are
      // fire-and-forget so a DB blip can't strand the redirect.
      if (killedSessionId) {
        const reasonAction =
          kickReason === "idle"
            ? AUDIT_ACTION.SESSION_TIMEOUT_LOGOUT
            : AUDIT_ACTION.SESSION_FORCED_REROTATE;
        runWithTenant({ kind: "SYSTEM" }, async () => {
          await prisma.userSession
            .delete({ where: { id: killedSessionId! } })
            .catch(() => {});
          await prisma.auditLog
            .create({
              data: {
                clinicId: session.user.clinicId ?? null,
                actorId: session.user.id,
                action: reasonAction,
                entityType: "UserSession",
                entityId: killedSessionId!,
                meta:
                  kickReason === "idle"
                    ? { reason: "idle" }
                    : { reason: "forced-rerotate" },
              },
            })
            .catch(() => {});
        }).catch(() => {});
      }
      return res;
    }

    // Bump lastActivityAt opportunistically. Skip for static-asset-like
    // hits (handled by the `matcher` exclusion) and skip for the
    // "session" API endpoint to avoid write amplification when the JWT
    // refreshes.
    if (bumpSessionId) {
      runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.userSession
          .update({
            where: { id: bumpSessionId! },
            data: { lastActivityAt: new Date() },
          })
          .catch(() => {}),
      ).catch(() => {});
    }

    // 3. mustChangePassword redirect (Phase 11 / #190).
    if (
      session.user.mustChangePassword &&
      !subpath.startsWith(CHANGE_PASSWORD_SUBPATH)
    ) {
      return NextResponse.redirect(
        buildCrmRedirect(request, locale, "crm/me/change-password"),
      );
    }

    // 4. Phase 17 Wave 2 — mandatory TOTP enrolment redirect. We resolve
    // the user's role + clinic flag once per request when there's a chance
    // it might fire. Cheap because tableid'd lookups + memory cache.
    const isEnrolPath = isExemptFromForcedRedirect(subpath, [
      ...SECURITY_ENROL_SUBPATHS,
      CHANGE_PASSWORD_SUBPATH,
    ]);
    if (!isEnrolPath) {
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
          const requires = requiresTotpEnrollment({
            role: me.role as Role,
            clinicRequire2faForAll: me.clinic?.require2faForAll ?? false,
          });
          if (requires && !me.totpEnabledAt) {
            return NextResponse.redirect(
              buildCrmRedirect(request, locale, "crm/me/security"),
            );
          }
        }
      } catch {
        // DB blip — let the request through; the next hit retries.
      }
    }
  }
  return intlMiddleware(request);
}

export const config = {
  matcher: [
    "/((?!api|_next|_vercel|login|admin|kiosk|tv|receptionist|ticket|c\\/|q\\/|.*\\..*).*)",
  ],
};
