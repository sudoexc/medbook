/**
 * /api/crm/users/[id] — read / update / soft-delete a clinic staff user.
 *
 * ADMIN only. Tenant-scoped manually (User is in MODELS_WITHOUT_TENANT).
 *
 * PATCH keeps the doctor-card binding in step with the account (audit
 * ST-04, see `planDoctorBinding`): switching «Активен» off or leaving the
 * DOCTOR role releases the card like DELETE does, and an active DOCTOR
 * without a card (a reactivation, a promotion) needs `doctorId`. Nobody can
 * deactivate their own account here either, as in DELETE.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import {
  invalidateSessionGuardCache,
  revokeUserSessions,
} from "@/server/auth/session-guard";
import { ok, err, notFound, diff } from "@/server/http";
import { UpdateUserSchema } from "@/server/schemas/user";
import { planDoctorBinding, redactStaffUser } from "@/server/users/staff-user";
import { runClinicWide } from "@/server/branches/branch-rules";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

// Secrets (password hash, TOTP material) never leave the server, not even
// into the audit diff.
const redactUser = redactStaffUser;

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = idFromUrl(request);
    const row = await prisma.user.findFirst({
      where: { id, clinicId: ctx.clinicId },
    });
    if (!row) return notFound();
    return ok(redactUser(row));
  }
);

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpdateUserSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = idFromUrl(request);
    const before = await prisma.user.findFirst({
      where: { id, clinicId: ctx.clinicId },
    });
    if (!before) return notFound();

    // Email is globally unique on User — a change that collides with another
    // account must surface a clean 409, not a raw Prisma unique-constraint 500.
    if (body.email && body.email !== before.email) {
      const clash = await prisma.user.findUnique({
        where: { email: body.email },
      });
      if (clash && clash.id !== id) {
        return err("conflict", 409, { reason: "email_taken" });
      }
    }

    // Block role-elevation into SUPER_ADMIN from the tenant endpoint.
    if (body.role === "SUPER_ADMIN") {
      return err("Forbidden", 403, { reason: "cannot_elevate_super_admin" });
    }
    // Same rule as DELETE: locking yourself out is never what was meant.
    if (body.active === false && before.active && id === ctx.userId) {
      return err("conflict", 409, { reason: "cannot_deactivate_self" });
    }
    // Last-ADMIN guard: any change that would shrink the active-ADMIN set on
    // this clinic to zero is rejected. Covers role demotion and active=false.
    const isAdminBefore = before.role === "ADMIN" && before.active;
    const willDemote = body.role !== undefined && body.role !== "ADMIN";
    const willDeactivate = body.active === false;
    if (isAdminBefore && (willDemote || willDeactivate)) {
      const adminsLeft = await prisma.user.count({
        where: { clinicId: ctx.clinicId, role: "ADMIN", active: true, id: { not: id } },
      });
      if (adminsLeft === 0) {
        return err("conflict", 409, { reason: "last_admin" });
      }
    }

    // The doctor-card binding follows the account's state after this edit.
    // Cards are looked up and moved clinic-wide: a selected branch must not
    // hide the card a doctor holds in another one.
    const currentCard = await runClinicWide(ctx, () =>
      prisma.doctor.findFirst({ where: { userId: id }, select: { id: true } }),
    );
    const binding = planDoctorBinding({
      nextRole: body.role ?? before.role,
      nextActive: body.active ?? before.active,
      currentCardId: currentCard?.id ?? null,
      requestedCardId: body.doctorId ?? null,
    });
    if (!binding.ok) {
      return err("validation", 422, { reason: binding.reason });
    }
    if (binding.linkCardId) {
      // Scoped to this clinic by the tenant extension; spelled out anyway.
      const linkCardId = binding.linkCardId;
      const doctor = await runClinicWide(ctx, () =>
        prisma.doctor.findFirst({
          where: { id: linkCardId, clinicId: ctx.clinicId },
          select: { id: true, userId: true },
        }),
      );
      if (!doctor) return err("conflict", 422, { reason: "doctor_not_found" });
      if (doctor.userId) return err("conflict", 409, { reason: "doctor_taken" });
    }

    // Password change must go through reset-password endpoint.
    const { password: _pw, ...rest } = body;
    void _pw;

    let after;
    try {
      after = await runClinicWide(ctx, () => prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id },
          data: {
            ...(rest.email !== undefined ? { email: rest.email } : {}),
            ...(rest.name !== undefined ? { name: rest.name } : {}),
            ...(rest.role !== undefined ? { role: rest.role } : {}),
            ...(rest.phone !== undefined ? { phone: rest.phone } : {}),
            ...(rest.photoUrl !== undefined ? { photoUrl: rest.photoUrl } : {}),
            ...(rest.telegramId !== undefined ? { telegramId: rest.telegramId } : {}),
            ...(rest.active !== undefined ? { active: rest.active } : {}),
          },
        });
        // Release first: Doctor.userId is unique.
        if (binding.unlinkCardId) {
          await tx.doctor.updateMany({
            where: { id: binding.unlinkCardId, userId: id },
            data: { userId: null },
          });
        }
        if (binding.linkCardId) {
          await tx.doctor.update({
            where: { id: binding.linkCardId },
            data: { userId: id },
          });
        }
        return updated;
      }));
    } catch (e) {
      // Another admin bound the same card a moment earlier.
      const msg = (e as Error).message || "";
      if (msg.includes("Unique") && msg.includes("userId")) {
        return err("conflict", 409, { reason: "doctor_taken" });
      }
      throw e;
    }

    // Deactivation takes effect at once, not when the JWT expires (audit
    // SEC-05). A role change needs no revocation: the session guard re-reads
    // the role on every request, so a demoted user hits 403 on the next call.
    if (rest.active === false && before.active) {
      await revokeUserSessions(id);
    } else {
      invalidateSessionGuardCache(id);
    }

    const d = diff(
      redactUser(before) as unknown as Record<string, unknown>,
      redactUser(after) as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "user.update",
      entityType: "User",
      entityId: id,
      meta: {
        ...d,
        ...(binding.unlinkCardId || binding.linkCardId
          ? {
              doctorCard: {
                released: binding.unlinkCardId,
                bound: binding.linkCardId,
              },
            }
          : {}),
      },
    });
    return ok(redactUser(after));
  }
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = idFromUrl(request);
    const before = await prisma.user.findFirst({
      where: { id, clinicId: ctx.clinicId },
    });
    if (!before) return notFound();

    // Block deactivating the last active admin.
    if (before.role === "ADMIN") {
      const adminsLeft = await prisma.user.count({
        where: { clinicId: ctx.clinicId, role: "ADMIN", active: true, id: { not: id } },
      });
      if (adminsLeft === 0) {
        return err("conflict", 409, { reason: "last_admin" });
      }
    }
    // Prevent self-deactivation.
    if (before.id === ctx.userId) {
      return err("conflict", 409, { reason: "cannot_deactivate_self" });
    }

    // If this user is bound to a Doctor card (Doctor.userId UNIQUE), free
    // that binding so the doctor card becomes orphan and can be re-bound to
    // a new user account. Without this the Doctor row is permanently
    // unbindable until manual DB cleanup.
    // Clinic-wide, like PATCH: the card may sit in another branch.
    await runClinicWide(ctx, () =>
      prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id },
          data: { active: false },
        });
        await tx.doctor.updateMany({
          where: { userId: id },
          data: { userId: null },
        });
      }),
    );
    // A deactivated employee is out on their very next request (audit
    // SEC-05); the session guard also rejects inactive accounts, this just
    // drops the rows so no stale session is left behind.
    const revokedSessions = await revokeUserSessions(id);
    await audit(request, {
      action: "user.deactivate",
      entityType: "User",
      entityId: id,
      meta: { before: redactUser(before), revokedSessions },
    });
    return ok({ id, deactivated: true });
  }
);
