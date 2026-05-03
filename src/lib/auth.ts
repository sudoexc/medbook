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
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === "string" ? credentials.email : null;
        const password =
          typeof credentials?.password === "string"
            ? credentials.password
            : null;
        if (!email || !password) return null;

        // User is in MODELS_WITHOUT_TENANT so the extension will not try
        // to inject a clinicId — and we're outside `runWithTenant` anyway.
        const user = await runWithTenant({ kind: "SYSTEM" }, () =>
          prisma.user.findUnique({ where: { email } })
        );
        if (!user?.passwordHash || !user.active) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

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
      if (token.role === "SUPER_ADMIN") {
        try {
          const store = await cookies();
          const overrideCookie = store.get(OVERRIDE_COOKIE_NAME);
          const overridden = verifyClinicOverride(overrideCookie?.value ?? null);
          token.clinicId = overridden;
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
      return session;
    },
  },
});
