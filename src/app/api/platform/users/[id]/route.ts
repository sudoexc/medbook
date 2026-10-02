/**
 * PATCH /api/platform/users/[id] — reassign clinic, change role, deactivate,
 * reset 2FA.
 *
 * SUPER_ADMIN only. Demoting oneself is blocked (can't lock the platform).
 * `resetTotp: true` wipes the user's TOTP (audit ST-03): a clinic's only
 * ADMIN who lost the phone has no colleague to do it from the clinic.
 *
 * The CRM's account rules hold here too (audit G5-06, see
 * `server/platform/user-change.ts`): the last active ADMIN of a clinic is not
 * switched off, demoted or moved away (409 `last_admin`), an active doctor
 * is not moved away from the clinic holding their doctor card (409
 * `doctor_card_bound`), and a doctor switched off or given another role has
 * the card released. The audit row carries the values before and after.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, err, notFound, diff } from "@/server/http";
import { platformAudit, requireSuperAdmin } from "@/server/platform/handler";
import { PatchPlatformUserSchema } from "@/server/schemas/platform";
import {
  invalidateSessionGuardCache,
  revokeUserSessions,
} from "@/server/auth/session-guard";
import { TOTP_RESET_DATA, totpResetRefusal } from "@/server/auth/totp-reset";
import {
  leavesAdminSeat,
  planPlatformDoctorCard,
  type AccountState,
} from "@/server/platform/user-change";

function idFromUrl(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const segs = url.pathname.split("/").filter(Boolean);
    // /api/platform/users/[id]
    //  0   1        2      3
    return segs[3] ?? null;
  } catch {
    return null;
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, async () => {
    const id = idFromUrl(request);
    if (!id) return err("BadRequest", 400);
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return err("InvalidJson", 400);
    }
    const parsed = PatchPlatformUserSchema.safeParse(raw);
    if (!parsed.success) {
      return err("ValidationError", 400, { issues: parsed.error.issues });
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return notFound();

    const resetTotp = parsed.data.resetTotp === true;
    if (resetTotp) {
      const refusal = totpResetRefusal({
        actorId: gate.userId,
        target,
        allowSuperAdminTarget: true,
      });
      if (refusal) return err("conflict", 409, { reason: refusal });
    }

    // Self-protection: can't demote or deactivate yourself.
    if (id === gate.userId) {
      if (parsed.data.active === false) {
        return err("Forbidden", 403, { reason: "cannot_deactivate_self" });
      }
      if (parsed.data.role && parsed.data.role !== "SUPER_ADMIN") {
        return err("Forbidden", 403, { reason: "cannot_demote_self" });
      }
    }

    // If reassigning clinic → validate target clinic exists (or null for SA).
    if (parsed.data.clinicId) {
      const c = await prisma.clinic.findUnique({
        where: { id: parsed.data.clinicId },
        select: { id: true },
      });
      if (!c) return err("NotFound", 404, { reason: "clinic_not_found" });
    }

    // Non-SUPER_ADMIN must have a clinicId — nulling it is only valid for SA.
    const nextRole = parsed.data.role ?? target.role;
    const nextClinicId =
      parsed.data.clinicId === undefined ? target.clinicId : parsed.data.clinicId;
    if (nextRole !== "SUPER_ADMIN" && !nextClinicId) {
      return err("ValidationError", 400, {
        reason: "non_super_admin_requires_clinic",
      });
    }

    const beforeState: AccountState = {
      role: target.role,
      active: target.active,
      clinicId: target.clinicId,
    };
    const afterState: AccountState = {
      role: nextRole,
      active: parsed.data.active ?? target.active,
      clinicId: nextClinicId ?? null,
    };
    // Same guard as the CRM: a clinic is never left without an active ADMIN.
    if (leavesAdminSeat(beforeState, afterState)) {
      const adminsLeft = await prisma.user.count({
        where: {
          clinicId: beforeState.clinicId,
          role: "ADMIN",
          active: true,
          id: { not: id },
        },
      });
      if (adminsLeft === 0) {
        return err("conflict", 409, { reason: "last_admin" });
      }
    }
    // The doctor card only matters when the account itself changes (not for
    // a bare 2FA reset).
    const accountChanges =
      afterState.role !== beforeState.role ||
      afterState.active !== beforeState.active ||
      afterState.clinicId !== beforeState.clinicId;
    const card = accountChanges
      ? await prisma.doctor.findFirst({
          where: { userId: id },
          select: { id: true, clinicId: true },
        })
      : null;
    const cardPlan = planPlatformDoctorCard({ after: afterState, card });
    if (!cardPlan.ok) {
      return err("conflict", 409, { reason: cardPlan.reason });
    }

    const userUpdate = {
      where: { id },
      data: {
        ...(parsed.data.clinicId !== undefined
          ? { clinicId: parsed.data.clinicId ?? null }
          : {}),
        ...(parsed.data.role ? { role: parsed.data.role } : {}),
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
        ...(resetTotp ? TOTP_RESET_DATA : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        clinicId: true,
      },
    } as const;
    const unlinkCardId = cardPlan.unlinkCardId;
    const updated = unlinkCardId
      ? await prisma.$transaction(async (tx) => {
          const u = await tx.user.update(userUpdate);
          // The card goes back to «врачи без логина» of its clinic.
          await tx.doctor.updateMany({
            where: { id: unlinkCardId, userId: id },
            data: { userId: null },
          });
          return u;
        })
      : await prisma.user.update(userUpdate);

    // Moving someone to another clinic or deactivating them ends their open
    // sessions (audit SEC-05): the old JWT still names the old clinic, and
    // the session guard would reject it anyway; dropping the rows makes the
    // cut immediate and leaves nothing behind.
    const movedClinic = updated.clinicId !== target.clinicId;
    const deactivated = target.active && !updated.active;
    // A 2FA reset ends the sessions too: one opened with the lost phone's
    // codes must not outlive them.
    let revokedSessions: number | null = null;
    if (movedClinic || deactivated || resetTotp) {
      revokedSessions = await revokeUserSessions(id);
    } else {
      // A role change applies on the next request (the guard re-reads it).
      invalidateSessionGuardCache(id);
    }

    await platformAudit({
      request,
      userId: gate.userId,
      clinicId: updated.clinicId,
      action: "user.update",
      entityType: "User",
      entityId: id,
      meta: {
        changed: Object.keys(parsed.data),
        previousClinicId: target.clinicId,
        previousRole: target.role,
        // The new values too, not only which fields moved.
        ...diff(beforeState as Record<string, unknown>, {
          role: updated.role,
          active: updated.active,
          clinicId: updated.clinicId,
        }),
        ...(unlinkCardId ? { doctorCard: { released: unlinkCardId } } : {}),
      },
    });
    if (resetTotp) {
      // Its own row, so an auditor filtering by action finds every reset.
      await platformAudit({
        request,
        userId: gate.userId,
        clinicId: updated.clinicId,
        action: AUDIT_ACTION.TOTP_RESET_BY_ADMIN,
        entityType: "User",
        entityId: id,
        meta: { by: gate.userId, via: "platform", revokedSessions },
      });
    }

    return ok(updated);
  });
}
