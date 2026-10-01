/**
 * PATCH /api/platform/users/[id] — reassign clinic, change role, deactivate,
 * reset 2FA.
 *
 * SUPER_ADMIN only. Demoting oneself is blocked (can't lock the platform).
 * `resetTotp: true` wipes the user's TOTP (audit ST-03): a clinic's only
 * ADMIN who lost the phone has no colleague to do it from the clinic.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, err, notFound } from "@/server/http";
import { platformAudit, requireSuperAdmin } from "@/server/platform/handler";
import { PatchPlatformUserSchema } from "@/server/schemas/platform";
import {
  invalidateSessionGuardCache,
  revokeUserSessions,
} from "@/server/auth/session-guard";
import { TOTP_RESET_DATA, totpResetRefusal } from "@/server/auth/totp-reset";

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

    const updated = await prisma.user.update({
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
    });

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
