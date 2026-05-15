/**
 * GET /api/crm/doctors/me/security-summary — minimal status snapshot for the
 * "Безопасность" tab on /doctor/settings.
 *
 * Returns booleans + counters, never secrets. Actual password change / TOTP
 * enrolment / session revocation lives at `/crm/me/security`; this endpoint
 * exists so the tab card can render without redirecting.
 *
 * `activeSessions` counts rows in `UserSession` (the CRM proxy session
 * table), NOT NextAuth's `Session` table — the latter is empty under JWT
 * strategy. By policy the count is ≤ 1 (concurrent sessions are kicked on
 * fresh sign-in), so the typical value is 1 while the user is signed in.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const [user, activeSessions] = await Promise.all([
      prisma.user.findUnique({
        where: { id: ctx.userId },
        select: {
          passwordHash: true,
          totpEnabledAt: true,
          lastLoginAt: true,
          mustChangePassword: true,
        },
      }),
      prisma.userSession.count({ where: { userId: ctx.userId } }),
    ]);
    if (!user) return err("NotFound", 404);

    return ok({
      passwordSet: Boolean(user.passwordHash),
      twoFactorEnabled: Boolean(user.totpEnabledAt),
      activeSessions,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    });
  },
);
