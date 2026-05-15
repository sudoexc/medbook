/**
 * GET /api/crm/doctors/me/security-summary — minimal status snapshot for the
 * "Безопасность" tab on /doctor/settings.
 *
 * Returns booleans + counters, never secrets. Actual password change / TOTP
 * enrolment / session revocation lives at `/crm/me/security`; this endpoint
 * exists so the tab card can render without redirecting.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const now = new Date();
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
      prisma.session.count({
        where: { userId: ctx.userId, expires: { gt: now } },
      }),
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
