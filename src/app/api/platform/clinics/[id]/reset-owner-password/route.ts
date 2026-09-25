/**
 * POST /api/platform/clinics/[id]/reset-owner-password — recovery action for
 * SUPER_ADMIN when a clinic owner has lost or never received their temp
 * password.
 *
 * Strategy: pick the oldest active ADMIN of the clinic (the original owner in
 * 99% of cases — onboarding always provisions exactly one) and reset their
 * password to a fresh server-generated value with mustChangePassword=true.
 * The plaintext is returned exactly once, same one-shot pattern as creation.
 *
 * If the clinic somehow has no ADMIN we 404 — the operator should look at
 * /admin/users instead.
 *
 * Like the clinic-side reset, this ends the owner's open sessions (audit
 * SEC-07): a reset has to push out whoever holds the old password.
 */
import { prisma } from "@/lib/prisma";
import { ok, err, notFound } from "@/server/http";
import {
  createPlatformHandler,
  platformAudit,
  idFromUrl,
} from "@/server/platform/handler";
import { generateTempPassword, hashPassword } from "@/server/auth/password";
import { revokeUserSessions } from "@/server/auth/session-guard";

export const POST = createPlatformHandler(
  { /* no body */ },
  async ({ request, userId }) => {
    // Path: /api/platform/clinics/[id]/reset-owner-password → segment 3 is [id]
    const id = idFromUrl(request, 3);
    if (!id) return err("BadRequest", 400, { reason: "missing_id" });

    const clinic = await prisma.clinic.findUnique({
      where: { id },
      select: { id: true, slug: true },
    });
    if (!clinic) return notFound();

    const owner = await prisma.user.findFirst({
      where: { clinicId: id, role: "ADMIN", active: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true },
    });
    if (!owner) {
      return err("conflict", 409, { reason: "no_active_owner" });
    }

    const tempPassword = generateTempPassword(12);
    const passwordHash = await hashPassword(tempPassword);
    await prisma.user.update({
      where: { id: owner.id },
      data: { passwordHash, mustChangePassword: true },
    });
    const revokedSessions = await revokeUserSessions(owner.id);

    await platformAudit({
      request,
      userId,
      clinicId: id,
      action: "clinic.reset_owner_password",
      entityType: "User",
      entityId: owner.id,
      meta: { ownerEmail: owner.email, revokedSessions },
    });

    return ok({
      ownerLogin: owner.email,
      ownerTempPassword: tempPassword,
    });
  },
);
