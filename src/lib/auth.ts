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
import type { JWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { cookies } from "next/headers";

import { prisma } from "./prisma";
import { runUnscoped, runWithTenant } from "./tenant-context";
import type { Role } from "./tenant-context";
import {
  OVERRIDE_COOKIE_NAME,
  verifyClinicOverride,
} from "@/server/platform/clinic-override";
import { verifyTotpCode } from "@/server/auth/totp";
import { readTotpSecret } from "@/server/crypto/secret-fields";
import {
  consumeRecoveryCode,
  type ConsumeResult,
} from "@/server/auth/recovery-codes";
import {
  SESSION_COOKIE_NAME,
  hashSessionToken,
  mintUserSessionOnSignIn,
} from "@/server/auth/user-session";
import { is2faDisabled } from "@/server/auth/security-policy";
import {
  deleteSessionById,
  evaluateStaffSession,
  type SessionBinding,
} from "@/server/auth/session-guard";
import {
  checkLoginThrottle,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/server/auth/login-throttle";
import { verifyPasswordConstantTime } from "@/server/auth/password";
import { realClientIp } from "./client-ip";

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

/**
 * Which server-side UserSession this JWT belongs to (see session-guard.ts).
 * New JWTs carry the row id; older ones only have the `crm_user_session`
 * cookie next to them.
 */
async function sessionBindingFor(token: JWT): Promise<SessionBinding> {
  if (typeof token.sid === "string" && token.sid) {
    return { kind: "sid", sessionId: token.sid };
  }
  if (token.sidUnbound) return { kind: "unbound" };
  try {
    const store = await cookies();
    const value = store.get(SESSION_COOKIE_NAME)?.value;
    return value
      ? { kind: "cookie", tokenHash: hashSessionToken(value) }
      : { kind: "none" };
  } catch {
    // No request scope to read cookies from: we cannot tell, so do not
    // reject on the binding alone (the account checks still run).
    return { kind: "unbound" };
  }
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
  events: {
    // Sign-out ends the server-side session too, not just the cookie: a copy
    // of the JWT lifted from this browser stops working at once (audit
    // SEC-06).
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      const sid = typeof token?.sid === "string" ? token.sid : null;
      try {
        if (sid) {
          await deleteSessionById(sid);
        } else {
          const store = await cookies();
          const value = store.get(SESSION_COOKIE_NAME)?.value;
          if (value) {
            await runWithTenant({ kind: "SYSTEM" }, () =>
              prisma.userSession.deleteMany({
                where: { tokenHash: hashSessionToken(value) },
              }),
            );
          }
        }
      } catch (err) {
        console.error("[auth] sign-out session cleanup failed", err);
      }
      try {
        const store = await cookies();
        store.set(SESSION_COOKIE_NAME, "", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 0,
        });
      } catch {
        // Outside a request scope; the row is gone, which is what matters.
      }
    },
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
      async authorize(credentials, request) {
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

        // Failed-attempt throttle (audit SEC-02/SEC-03). The route wrapper
        // already answers 429 before we get here; this is the backstop for
        // any other way into the credentials provider.
        const who = { ip: request ? realClientIp(request) : "unknown", email };
        if (checkLoginThrottle(who).blocked) return null;

        // User is in MODELS_WITHOUT_TENANT so the extension will not try
        // to inject a clinicId — and we're outside `runWithTenant` anyway.
        const user = await runWithTenant({ kind: "SYSTEM" }, () =>
          prisma.user.findUnique({ where: { email } }),
        );
        // One bcrypt comparison on every path, so an unknown or inactive
        // login costs the same time as a wrong password.
        const valid = await verifyPasswordConstantTime(
          password,
          user?.passwordHash,
        );
        if (!user || !user.active || !valid) {
          recordLoginFailure(who);
          return null;
        }

        // 2FA gate. When the user has enrolled, we require either a
        // current TOTP code or a recovery code on the same submit. The
        // `/login/2fa` page collects exactly one of these and re-submits
        // the credentials together; the password-only path is rejected.
        //
        // `DISABLE_2FA=1` short-circuits the gate entirely — even enrolled
        // users can log in with password alone. Used in dev/staging and as
        // a short-term ops bypass.
        if (user.totpEnabledAt && user.totpSecret && !is2faDisabled()) {
          if (totp) {
            // Stored secret is AES-GCM ciphertext at rest (legacy plaintext
            // tolerated until the backfill runs) — decrypt before verifying.
            if (!verifyTotpCode(readTotpSecret(user.totpSecret), totp)) {
              recordLoginFailure(who);
              return null;
            }
          } else if (recoveryCode) {
            const result: ConsumeResult = await consumeRecoveryCode(
              recoveryCode,
              user.recoveryCodesHash,
            );
            if (!result.ok) {
              recordLoginFailure(who);
              return null;
            }
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

        recordLoginSuccess(who);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role as Role,
          clinicId: user.clinicId ?? null,
          mustChangePassword: user.mustChangePassword,
          preferredLocale: user.preferredLocale,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id ?? token.sub;
        const u = user as {
          role?: Role;
          clinicId?: string | null;
          id?: string;
          mustChangePassword?: boolean;
          preferredLocale?: string;
        };
        token.role = u.role;
        token.clinicId = u.clinicId ?? null;
        token.userId = u.id ?? token.sub;
        token.mustChangePassword = Boolean(u.mustChangePassword);
        // Seed the UI-language cookie from the persisted staff preference so a
        // fresh browser/device lands in the saved language. Best-effort: a
        // cookie-write failure (e.g. invoked outside a request scope) must
        // never break sign-in. Mirrors the `cookies()` usage in
        // mintUserSessionOnSignIn below.
        if (u.preferredLocale === "ru" || u.preferredLocale === "uz") {
          try {
            const store = await cookies();
            store.set("NEXT_LOCALE", u.preferredLocale, {
              path: "/",
              maxAge: 60 * 60 * 24 * 365,
              sameSite: "lax",
            });
          } catch {
            // Outside a request scope — cookie will be seeded on next switch.
          }
        }
        // Phase 17 Wave 2 — fresh signin: mint a UserSession, kick prior
        // ones, and seed the user-session cookie. Stamping happens here
        // instead of an `events.signIn` because events cannot write
        // cookies, but the jwt callback can. We also stamp
        // `User.lastSessionRotatedAt` so the proxy's 8h hard-cap check
        // has a single source of truth.
        //
        // The session id also goes INTO the JWT (`sid`), so every later
        // request can be checked against that exact row without trusting a
        // second cookie (audit SEC-06). If minting fails we still let the
        // sign-in through, flagged `sidUnbound`, instead of looping the user
        // back to /login on every request.
        if (u.id) {
          try {
            const minted = await mintUserSessionOnSignIn(u.id, u.clinicId ?? null);
            token.sid = minted.sessionId;
            token.sidUnbound = false;
          } catch (err) {
            console.error("[auth] failed to mint UserSession", err);
            token.sid = null;
            token.sidUnbound = true;
          }
        }
        // Signed in with an admin-issued temporary password: remember when,
        // so /api/crm/me/password can let THIS fresh session set a new
        // password without re-typing the temp one, and only for a short
        // window (audit SEC-07).
        token.pwTempAt = u.mustChangePassword ? Date.now() : null;
      } else {
        // Every later `auth()` call: is the session still alive and is the
        // account still allowed? A "no" logs the browser out everywhere at
        // once (pages redirect to /login, APIs answer 401). A "yes" refreshes
        // role / clinic / mustChangePassword from the database, so a demotion
        // or a finished password change applies on the next request instead
        // of after the 24h JWT expires (audit SEC-05, SEC-06, DC-02).
        const userId = (token.userId as string | undefined) ?? token.sub;
        if (!userId || !token.role) return null;
        let verdict: Awaited<ReturnType<typeof evaluateStaffSession>>;
        try {
          verdict = await evaluateStaffSession({
            claims: {
              userId,
              role: token.role as Role,
              clinicId: (token.clinicId as string | null | undefined) ?? null,
            },
            binding: await sessionBindingFor(token),
          });
        } catch (err) {
          // An unexpected failure here must not sign the whole clinic out
          // (and a throw from this callback would). Keep the claims as they
          // are, like a database error inside the guard does.
          console.error("[auth] session guard failed, failing open", err);
          verdict = { ok: true, sessionId: null, fresh: null };
        }
        if (!verdict.ok) return null;
        if (verdict.fresh) {
          token.role = verdict.fresh.role;
          if (verdict.fresh.role !== "SUPER_ADMIN") {
            token.clinicId = verdict.fresh.clinicId;
          }
          token.mustChangePassword = verdict.fresh.mustChangePassword;
          if (!verdict.fresh.mustChangePassword) token.pwTempAt = null;
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
                // The JWT callback runs outside any runWithTenant boundary,
                // and ImpersonationGrant is tenant-scoped — without an
                // explicit bypass the fail-closed Prisma extension would
                // throw here and the catch below would silently drop every
                // impersonation. Safe: lookup is by unguessable grant id,
                // and the result is cross-checked against the signed cookie.
                const active = await runUnscoped(
                  "auth: verify SUPER_ADMIN impersonation grant during JWT refresh",
                  () => getActiveGrant(grantId),
                );
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
                // DB read failed — fail closed. We cannot confirm an active
                // grant, so the override is NOT honoured (an unverifiable
                // impersonation is treated as none). The admin drops back to
                // the platform view and can re-impersonate.
                token.clinicId = null;
                token.impersonationGrantId = null;
                token.impersonationMode = null;
              }
            } else {
              // Override cookie present but grant cookie missing/expired. No
              // live grant ⇒ no impersonation (fail closed). Honouring a
              // grant-less override would be an ungateable WRITE outliving the
              // 60-min lease, so we drop it.
              token.clinicId = null;
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
      session.user.sessionId =
        typeof token.sid === "string" && token.sid ? token.sid : null;
      session.user.tempPasswordLoginAt =
        typeof token.pwTempAt === "number" ? token.pwTempAt : null;
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
