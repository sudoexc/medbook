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

import { prisma } from "./prisma";
import { runWithTenant } from "./tenant-context";
import type { Role } from "./tenant-context";

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
  session: { strategy: "jwt" },
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
        };
        token.role = u.role;
        token.clinicId = u.clinicId ?? null;
        token.userId = u.id ?? token.sub;
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
      return session;
    },
  },
});
