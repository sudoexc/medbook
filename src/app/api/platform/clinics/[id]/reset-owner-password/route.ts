/**
 * POST /api/platform/clinics/[id]/reset-owner-password — recovery action for
 * SUPER_ADMIN when a clinic owner has lost or never received their temp
 * password.
 *
 * GET lists the clinic's active ADMIN accounts (name, email), oldest first,
 * and POST resets the one named by `{ userId }` (audit G5-07). The schema has
 * no notion of "owner": the button used to reset whichever ADMIN was created
 * first, a seed or demo account as often as the owner, and the operator
 * learned whose password it was only from the result. The dialog now shows
 * the accounts and the operator picks one. Without `userId` the oldest active
 * ADMIN is still the default (the original owner in most clinics: onboarding
 * provisions exactly one).
 *
 * The new password is a fresh server-generated value with
 * mustChangePassword=true, returned exactly once, same one-shot pattern as
 * creation.
 *
 * If the clinic has no active ADMIN we answer 409 — the operator should look
 * at /admin/users instead.
 *
 * Like the clinic-side reset, this ends the owner's open sessions (audit
 * SEC-07): a reset has to push out whoever holds the old password.
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { ok, err, notFound } from "@/server/http";
import {
  createPlatformHandler,
  createPlatformListHandler,
  platformAudit,
  idFromUrl,
} from "@/server/platform/handler";
import { generateTempPassword, hashPassword } from "@/server/auth/password";
import { revokeUserSessions } from "@/server/auth/session-guard";

const ResetOwnerBodySchema = z.object({ userId: z.string().min(1).max(64).optional() });

/** The accounts the reset may target: active ADMINs, oldest (default) first. */
function activeAdmins(clinicId: string) {
  return prisma.user.findMany({
    where: { clinicId, role: "ADMIN", active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true },
  });
}

export const GET = createPlatformListHandler(async ({ request }) => {
  // Path: /api/platform/clinics/[id]/reset-owner-password → segment 3 is [id]
  const id = idFromUrl(request, 3);
  if (!id) return err("BadRequest", 400, { reason: "missing_id" });
  const clinic = await prisma.clinic.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!clinic) return notFound();
  return ok({ admins: await activeAdmins(id) });
});

export const POST = createPlatformHandler(
  { /* optional body, parsed below */ },
  async ({ request, userId }) => {
    // Path: /api/platform/clinics/[id]/reset-owner-password → segment 3 is [id]
    const id = idFromUrl(request, 3);
    if (!id) return err("BadRequest", 400, { reason: "missing_id" });

    // An empty body keeps the old one-click call working (oldest ADMIN).
    const text = await request.text().catch(() => "");
    let raw: unknown = {};
    if (text.trim()) {
      try {
        raw = JSON.parse(text);
      } catch {
        return err("InvalidJson", 400);
      }
    }
    const parsed = ResetOwnerBodySchema.safeParse(raw);
    if (!parsed.success) {
      return err("ValidationError", 400, { issues: parsed.error.issues });
    }

    const clinic = await prisma.clinic.findUnique({
      where: { id },
      select: { id: true, slug: true },
    });
    if (!clinic) return notFound();

    const admins = await activeAdmins(id);
    const owner = parsed.data.userId
      ? admins.find((a) => a.id === parsed.data.userId)
      : admins[0];
    if (!owner) {
      return err("conflict", 409, {
        // A picked account that is no longer an active ADMIN of this clinic
        // (demoted, moved, switched off since the dialog opened).
        reason: parsed.data.userId ? "owner_not_admin" : "no_active_owner",
      });
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
      meta: {
        ownerEmail: owner.email,
        picked: Boolean(parsed.data.userId),
        revokedSessions,
      },
    });

    return ok({
      ownerLogin: owner.email,
      ownerTempPassword: tempPassword,
    });
  },
);
