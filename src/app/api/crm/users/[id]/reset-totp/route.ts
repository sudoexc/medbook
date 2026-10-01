/**
 * POST /api/crm/users/[id]/reset-totp — an ADMIN wipes a colleague's 2FA
 * (audit ST-03): the phone with the authenticator is lost, the recovery
 * codes too, and without this the employee stayed locked out until a
 * developer edited the database.
 *
 * The admin re-enters their own password (a stolen admin session alone must
 * not be able to strip a colleague's second factor). The reset ends every
 * session of the user, and it is audited. Next sign-in: password only, then
 * enrolment again wherever the role or the clinic requires 2FA.
 *
 * ADMIN only, tenant-scoped (User is in MODELS_WITHOUT_TENANT, so the clinic
 * filter is explicit).
 */
import bcrypt from "bcryptjs";
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { rateLimit } from "@/lib/rate-limit";
import { ok, err, notFound } from "@/server/http";
import { revokeUserSessions } from "@/server/auth/session-guard";
import { TOTP_RESET_DATA, totpResetRefusal } from "@/server/auth/totp-reset";

const Schema = z.object({
  currentPassword: z.string().min(1).max(200),
});

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // /api/crm/users/[id]/reset-totp → id is second-to-last
  return parts[parts.length - 2] ?? "";
}

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: Schema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    // The password check below is a guessing surface like any other.
    if (!rateLimit(`totp-reset:${ctx.userId}`, 5, 15 * 60 * 1000)) {
      return err("RateLimited", 429);
    }

    const id = idFromUrl(request);
    const target = await prisma.user.findFirst({
      where: { id, clinicId: ctx.clinicId },
      select: { id: true, role: true, totpEnabledAt: true },
    });
    if (!target) return notFound();

    const me = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { passwordHash: true },
    });
    if (!me?.passwordHash) return err("Forbidden", 403, { reason: "no_password" });
    const okPw = await bcrypt.compare(body.currentPassword, me.passwordHash);
    if (!okPw) return err("Forbidden", 403, { reason: "wrong_password" });

    const refusal = totpResetRefusal({ actorId: ctx.userId, target });
    if (refusal) return err("conflict", 409, { reason: refusal });

    await prisma.user.update({ where: { id }, data: TOTP_RESET_DATA });
    // A session opened with the lost phone's codes must not outlive them.
    const revokedSessions = await revokeUserSessions(id);

    await audit(request, {
      action: AUDIT_ACTION.TOTP_RESET_BY_ADMIN,
      entityType: "User",
      entityId: id,
      meta: { by: ctx.userId, via: "clinic", revokedSessions },
    });
    return ok({ id, reset: true, revokedSessions });
  },
);
