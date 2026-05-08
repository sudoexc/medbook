/**
 * NextAuth 5 (beta) configuration.
 *
 * JWT claims enriched with the new multi-tenant schema (§5.5):
 *   - `userId`   : cuid() of the User
 *   - `role`     : SUPER_ADMIN | ADMIN | DOCTOR | RECEPTIONIST | NURSE | CALL_OPERATOR
 *   - `clinicId` : tenant id, nullable (SUPER_ADMIN has no home clinic)
 *
 * These claims are read by `src/lib/api-handler.ts` to build a `TenantContext`
 * for each request.
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

import { prisma } from "./prisma";
import { runWithTenant } from "./tenant-context";
import type { Role } from "./tenant-context";
import {
  OVERRIDE_COOKIE_NAME,
  verifyClinicOverride,
} from "@/server/platform/clinic-override";
import { verifyTotpCode } from "@/server/auth/totp";
import {
  consumeRecoveryCode,
  type ConsumeResult,
} from "@/server/auth/recovery-codes";
import { mintUserSessionOnSignIn } from "@/server/auth/user-session";

const APP_ROLES: ReadonlySet<Role> = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "DOCTOR",
  "RECEPTIONIST",
  "NURSE",
  "CALL_OPERATOR",
]);

function assertRole(value: unknown): Role {
  if (typeof value === "string" && APP_ROLES.has(value as Role)) {
    return value as Role;
  }
  throw new Error(`Invalid session role: ${String(value)}`);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // CRM session TTL is capped at 24h per TZ §9.2. `updateAge` rotates the
  // JWT at most hourly while the user is active so the cookie stays fresh
  // without re-issuing on every request.
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24, // 24h
    updateAge: 60 * 60, // 1h
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // Phase 17 Wave 2 — second-factor inputs. The `/login` form omits
        // both on the first submit; if the user has TOTP enabled, the
        // login client routes them to /login/2fa where one of these is
        // populated for a follow-up signIn. Both empty → password-only
        // path (rejected when totpEnabledAt != null).
        totp: { label: "TOTP", type: "text" },
        recoveryCode: { label: "Recovery Code", type: "text" },
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === "string" ? credentials.email : null;
        const password =
          typeof credentials?.password === "string"
            ? credentials.password
            : null;
        if (!email || !password) return null;
        const totp =
          typeof credentials?.totp === "string" && credentials.totp.length > 0
            ? credentials.totp
            : null;
        const recoveryCode =
          typeof credentials?.recoveryCode === "string" &&
          credentials.recoveryCode.length > 0
            ? credentials.recoveryCode
            : null;

        // User is in MODELS_WITHOUT_TENANT so the extension will not try
        // to inject a clinicId — and we're outside `runWithTenant` anyway.
        const user = await runWithTenant({ kind: "SYSTEM" }, () =>
          prisma.user.findUnique({ where: { email } }),
        );
        if (!user?.passwordHash || !user.active) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        // 2FA gate. When the user has enrolled, we require either a
        // current TOTP code or a recovery code on the same submit. The
        // `/login/2fa` page collects exactly one of these and re-submits
        // the credentials together; the password-only path is rejected.
        if (user.totpEnabledAt && user.totpSecret) {
          if (totp) {
            if (!verifyTotpCode(user.totpSecret, totp)) return null;
          } else if (recoveryCode) {
            const result: ConsumeResult = await consumeRecoveryCode(
              recoveryCode,
              user.recoveryCodesHash,
            );
            if (!result.ok) return null;
            await runWithTenant({ kind: "SYSTEM" }, async () => {
              await prisma.user.update({
                where: { id: user.id },
                data: { recoveryCodesHash: result.remainingHashes },
              });
              // RECOVERY_CODE_USED audit fires inside the SYSTEM context so
              // it can write across tenants (the AuditLog model is in
              // MODELS_WITHOUT_TENANT but emit must still pick a clinicId).
              await prisma.auditLog
                .create({
                  data: {
                    clinicId: user.clinicId ?? null,
                    actorId: user.id,
                    actorRole: user.role,
                    actorLabel: user.email,
                    action: "RECOVERY_CODE_USED",
                    entityType: "User",
                    entityId: user.id,
                    meta: { remaining: result.remaining },
                  },
                })
                .catch((err: unknown) => {
                  console.error("[auth] RECOVERY_CODE_USED audit failed", err);
                });
            });
          } else {
            // Password is correct but a second factor is required and
            // missing. Returning null tells next-auth "wrong credentials"
            // — the login client maps this signal to a redirect to the
            // /login/2fa page (it knows the password worked because the
            // pre-flight /api/crm/auth/totp-required check returned true).
            return null;
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role as Role,
          clinicId: user.clinicId ?? null,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.sub = user.id ?? token.sub;
        const u = user as {
          role?: Role;
          clinicId?: string | null;
          id?: string;
          mustChangePassword?: boolean;
        };
        token.role = u.role;
        token.clinicId = u.clinicId ?? null;
        token.userId = u.id ?? token.sub;
        token.mustChangePassword = Boolean(u.mustChangePassword);
        // Phase 17 Wave 2 — fresh signin: mint a UserSession, kick prior
        // ones, and seed the user-session cookie. Stamping happens here
        // instead of an `events.signIn` because events cannot write
        // cookies, but the jwt callback can. We also stamp
        // `User.lastSessionRotatedAt` so the proxy's 8h hard-cap check
        // has a single source of truth.
        if (u.id) {
          try {
            await mintUserSessionOnSignIn(u.id, u.clinicId ?? null);
          } catch (err) {
            console.error("[auth] failed to mint UserSession", err);
          }
        }
      }
      // Refresh `mustChangePassword` and `active` from the DB on session
      // update so the middleware redirect releases the moment the user
      // finishes the change form, and a deactivated user is kicked out
      // as soon as their session re-validates. Without this we'd have to
      // wait for the JWT to refresh on its own (up to `updateAge`).
      // Note: full real-time deactivation across passive sessions still
      // has up to `updateAge` (1h) of drift; that is documented elsewhere.
      if (trigger === "update" && token.userId) {
        try {
          const fresh = await runWithTenant({ kind: "SYSTEM" }, () =>
            prisma.user.findUnique({
              where: { id: token.userId as string },
              select: { mustChangePassword: true, active: true },
            }),
          );
          if (fresh) {
            token.mustChangePassword = fresh.mustChangePassword;
            // Returning null invalidates the session, kicking the user
            // out on their next request.
            if (!fresh.active) return null;
          }
        } catch {
          // Ignore — stale claim is recoverable on the next refresh tick.
        }
      }
      // SUPER_ADMIN "impersonate clinic" cookie support. We re-read the
      // cookie on every JWT refresh so changes take effect on the next
      // request without requiring a fresh sign-in. Non-SUPER_ADMIN users
      // are unaffected (role check enforced here and in API guards).
      //
      // Phase 19 Wave 4 — paired with the `admin_grant_id` cookie. Stamps
      // the grant id and mode onto the JWT so downstream guards can find
      // the row in O(1). When the grant is missing/expired we drop the
      // override claim — the request layer will then redirect to
      // /admin/clinics on the next CRM page render.
      if (token.role === "SUPER_ADMIN") {
        try {
          const store = await cookies();
          const overrideCookie = store.get(OVERRIDE_COOKIE_NAME);
          const overridden = verifyClinicOverride(overrideCookie?.value ?? null);
          if (overridden) {
            const grantCookie = store.get("admin_grant_id");
            const grantId = grantCookie?.value ?? null;
            if (grantId) {
              try {
                const { getActiveGrant } = await import(
                  "@/server/platform/impersonation"
                );
                const active = await getActiveGrant(grantId);
                if (active && active.clinicId === overridden) {
                  token.clinicId = overridden;
                  token.impersonationGrantId = grantId;
                  token.impersonationMode = active.mode;
                } else {
                  // Grant gone / expired / mismatched — drop the override.
                  token.clinicId = null;
                  token.impersonationGrantId = null;
                  token.impersonationMode = null;
                }
              } catch {
                // DB read failed — keep cookie-only behaviour rather than
                // locking the SUPER_ADMIN out.
                token.clinicId = overridden;
              }
            } else {
              // Override cookie present but grant cookie missing. Treat as
              // legacy state and honour the override (back-compat with
              // pre-W4 sessions). Grant-less sessions cannot be VIEW_ONLY.
              token.clinicId = overridden;
              token.impersonationGrantId = null;
              token.impersonationMode = null;
            }
          } else {
            token.clinicId = null;
            token.impersonationGrantId = null;
            token.impersonationMode = null;
          }
        } catch {
          // Outside a request scope (e.g. during sign-in callback invoked
          // from a non-request context). Ignore and keep the existing claim.
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (!session.user) return session;
      const role = assertRole(token.role);
      session.user.id = (token.userId as string | undefined) ?? token.sub ?? "";
      session.user.role = role;
      session.user.clinicId =
        (token.clinicId as string | null | undefined) ?? null;
      session.user.mustChangePassword = Boolean(token.mustChangePassword);
      // Phase 19 Wave 4 — surface the active impersonation stamp so the
      // CRM layout and the createApiHandler wrapper can reject writes under
      // VIEW_ONLY without re-reading the grant row on every request.
      const grantId = token.impersonationGrantId as string | null | undefined;
      const mode = token.impersonationMode as
        | "WRITE"
        | "VIEW_ONLY"
        | null
        | undefined;
      if (grantId && mode) {
        session.user.impersonation = {
          grantId,
          mode,
        };
      } else {
        session.user.impersonation = null;
      }
      return session;
    },
  },
});
