/**
 * /api/crm/doctors/[id] — get/patch/delete. See docs/TZ.md §6.6.
 *
 * Cabinet binding (Phase 11):
 *   PATCH validates a changed cabinetId against the same rules as POST
 *   (cabinet must be in the clinic, active, and not occupied by anyone else)
 *   and moves the doctor's remaining visits to the new room in the same
 *   transaction (audit DR-11, `@/server/doctors/cabinet-move`).
 *   When a `services` array is supplied, the route replaces ALL existing
 *   ServiceOnDoctor rows for this doctor in a single transaction so the
 *   doctor's catalog never half-applies; dropping a service only this
 *   doctor performs is refused like a deactivation is (audit DR-07).
 *
 *   GET answers each role with the columns it may see (audit DR-09,
 *   `@/server/doctors/doctor-view`).
 *
 *   DELETE refuses (409) when soft-deleting this doctor would leave any of
 *   their services with zero remaining active doctors — services without a
 *   provider are forbidden by product rules.
 *
 * PATCH is the admin's (audit DR-16). A doctor used to reach it for his own
 * row with only a few fields stripped, so he could switch himself back on
 * after the admin took him out of service, or rename his public slug. He
 * edits his profile through /api/crm/doctors/me/profile, which takes the
 * profile fields only; nothing in the CRM sends him here.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound, diff } from "@/server/http";
import { UpdateDoctorSchema } from "@/server/schemas/doctor";
import { resolveEffectiveBranchId } from "@/server/branches/resolve-branch";
import {
  isTicketPrefixConflict,
  takenTicketPrefixes,
} from "@/server/doctors/ticket-prefix";
import {
  countDoctorDeleteBlockers,
  countStrandedAppointments,
  findServicesOrphanedByDeactivating,
  findServicesOrphanedByUnlinking,
} from "@/server/doctors/deactivation";
import { doctorAudience, doctorSelectFor } from "@/server/doctors/doctor-view";
import { findForeignServiceIds } from "@/server/doctors/service-links";
import { moveFutureAppointmentsToCabinet } from "@/server/doctors/cabinet-move";
import { isSlotOverlapViolation } from "@/server/appointments/overlap-violation";
import { publishEventSafe } from "@/server/realtime/publish";
import { invalidateSitePrices } from "@/lib/site-prices";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const audience = doctorAudience(ctx);
    const select = doctorSelectFor(audience);
    const relations = {
      services: { include: { service: true } },
      schedules: true,
      timeOffs: { where: { endAt: { gte: new Date() } } },
    } as const;
    const row = select
      ? await prisma.doctor.findUnique({
          where: { id },
          select: { ...select, ...relations },
        })
      : await prisma.doctor.findUnique({
          where: { id },
          include: { cabinet: true, ...relations },
        });
    if (!row) return notFound();
    // Why a doctor is away («больничный») is for the admin and the doctor
    // himself; everyone else sees the window only.
    const ownProfile =
      audience === "doctor" &&
      ctx.kind === "TENANT" &&
      (row as { userId?: string | null }).userId === ctx.userId;
    if (audience !== "admin" && !ownProfile) {
      return ok({
        ...row,
        timeOffs: row.timeOffs.map((t) => ({ ...t, reason: null })),
      });
    }
    return ok(row);
  }
);

export const PATCH = createApiHandler(
  {
    roles: ["ADMIN"],
    bodySchema: UpdateDoctorSchema,
  },
  async ({ request, body, ctx }) => {
    const id = idFromUrl(request);
    const before = await prisma.doctor.findUnique({ where: { id } });
    if (!before) return notFound();

    const data: Record<string, unknown> = { ...body };

    // Ticket letter (audit Q-12): unique within the clinic. The unique index
    // is the real guard; this pre-check answers with the doctor who holds the
    // letter instead of a bare conflict.
    if (
      typeof data.ticketPrefix === "string" &&
      data.ticketPrefix !== before.ticketPrefix
    ) {
      const holder = (
        await takenTicketPrefixes(prisma, before.clinicId)
      ).find((t) => t.ticketPrefix === data.ticketPrefix && t.id !== id);
      if (holder) {
        return err("conflict", 409, {
          reason: "ticket_prefix_taken",
          doctorId: holder.id,
        });
      }
    }

    // Resolve branch only when caller passed it.
    if (Object.prototype.hasOwnProperty.call(data, "branchId")) {
      try {
        data.branchId = await resolveEffectiveBranchId(
          ctx,
          data.branchId as string | null | undefined,
        );
      } catch (e) {
        const reason = (e as { reason?: string }).reason ?? "branch_invalid";
        return err("BranchInvalid", 422, { reason });
      }
    }

    // Validate cabinet swap when caller actually changes cabinetId.
    if (
      Object.prototype.hasOwnProperty.call(data, "cabinetId") &&
      data.cabinetId !== before.cabinetId
    ) {
      const cabinetId = data.cabinetId as string | null | undefined;
      if (!cabinetId) {
        // Doctors must occupy a cabinet — null/undefined isn't allowed.
        return err("CabinetInvalid", 422, { reason: "cabinet_required" });
      }
      const cabinet = await prisma.cabinet.findUnique({
        where: { id: cabinetId },
      });
      if (!cabinet || !cabinet.isActive) {
        return err("CabinetInvalid", 422, { reason: "cabinet_not_found" });
      }
      const occupant = await prisma.doctor.findUnique({
        where: { cabinetId },
      });
      if (occupant && occupant.id !== id) {
        return err("CabinetTaken", 409, {
          reason: "cabinet_taken",
          doctorId: occupant.id,
        });
      }
    }

    // Taking the doctor out of service through PATCH must respect the same
    // "no orphaned service" rule DELETE enforces — otherwise the guard is
    // just a speed bump on one of two identical paths.
    if (data.isActive === false && before.isActive) {
      const orphaned = await findServicesOrphanedByDeactivating(id);
      if (orphaned.length > 0) {
        return err("ServiceOrphaned", 409, {
          reason: "service_orphaned",
          orphanedServiceIds: orphaned.map((s) => s.id),
          orphanedServices: orphaned,
        });
      }
    }

    // Pull `services` out — handled via ServiceOnDoctor below.
    const services = data.services as
      | { serviceId: string; priceOverride?: number | null; durationMinOverride?: number | null }[]
      | undefined;
    delete data.services;

    // Only this clinic's services may be linked (audit DR-12).
    if (services) {
      const foreignServiceIds = await findForeignServiceIds(
        services.map((s) => s.serviceId),
        before.clinicId,
      );
      if (foreignServiceIds.length > 0) {
        return err("ServiceInvalid", 422, {
          reason: "service_not_found",
          serviceIds: foreignServiceIds,
        });
      }
    }

    // Replacing the catalog must not strand a service either (DR-07). A
    // deactivation in the same call was already checked above.
    if (services && data.isActive !== false) {
      const orphaned = await findServicesOrphanedByUnlinking(
        id,
        services.map((s) => s.serviceId),
      );
      if (orphaned.length > 0) {
        return err("ServiceOrphaned", 409, {
          reason: "service_orphaned",
          orphanedServiceIds: orphaned.map((s) => s.id),
          orphanedServices: orphaned,
        });
      }
    }

    const cabinetChanged =
      typeof data.cabinetId === "string" && data.cabinetId !== before.cabinetId;

    try {
      const txResult = await prisma.$transaction(async (tx) => {
        const updated = await tx.doctor.update({
          where: { id },
          data: data as never,
        });
        if (services) {
          // Replace the catalog wholesale: delete old rows, insert new.
          await tx.serviceOnDoctor.deleteMany({ where: { doctorId: id } });
          if (services.length > 0) {
            await tx.serviceOnDoctor.createMany({
              data: services.map((s) => ({
                doctorId: id,
                serviceId: s.serviceId,
                priceOverride: s.priceOverride ?? null,
                durationMinOverride: s.durationMinOverride ?? null,
              })),
            });
          }
        }
        const movedAppointments = cabinetChanged
          ? await moveFutureAppointmentsToCabinet(tx, {
              doctorId: id,
              cabinetId: data.cabinetId as string,
            })
          : 0;
        return { updated, movedAppointments };
      });
      const after = txResult.updated;
      const movedAppointments = txResult.movedAppointments;
      // The landing's price sheet names doctors and their prices: a doctor
      // taken off the site (LD-08) or a new price list must show on the next
      // page load, not after the sheet's one-minute cache.
      if (services || after.listedOnSite !== before.listedOnSite) {
        invalidateSitePrices();
      }
      if (movedAppointments > 0) {
        // Reception's queue, the doctor's day and the TV boards read the
        // cabinet off the visits: wake them so they show the new room.
        publishEventSafe(before.clinicId, {
          type: "queue.updated",
          payload: { doctorId: id },
        });
      }

      const d = diff(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>
      );
      // Deactivation must not silently strand the doctor's future visits:
      // they keep reminding patients while nobody serves them in the CRM.
      // Counted AFTER the update (non-blocking), surfaced for a loud toast.
      const strandedAppointments =
        data.isActive === false && before.isActive
          ? await countStrandedAppointments(id)
          : 0;
      await audit(request, {
        action: "doctor.update",
        entityType: "Doctor",
        entityId: id,
        meta: {
          ...d,
          servicesReplaced: Boolean(services),
          ...(strandedAppointments > 0 ? { strandedAppointments } : {}),
          ...(movedAppointments > 0 ? { movedAppointments } : {}),
        },
      });
      return ok({ ...after, strandedAppointments, movedAppointments });
    } catch (e) {
      // A visit already sits in the new room at the time of one of this
      // doctor's visits: nothing moved (the transaction rolled back).
      if (isSlotOverlapViolation(e)) {
        return err("CabinetBusy", 409, { reason: "cabinet_schedule_conflict" });
      }
      const msg = (e as Error).message || "";
      if (msg.includes("Unique") && msg.includes("cabinetId")) {
        return err("CabinetTaken", 409, { reason: "cabinet_taken" });
      }
      if (isTicketPrefixConflict(e)) {
        return err("conflict", 409, { reason: "ticket_prefix_taken" });
      }
      if (msg.includes("Unique")) {
        return err("conflict", 409, { reason: "slug_taken" });
      }
      throw e;
    }
  }
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const before = await prisma.doctor.findUnique({ where: { id } });
    if (!before) return notFound();

    // `?purge=true` — permanent removal, not the soft default. It exists
    // because a row created by mistake (typo, test doctor, a colleague who
    // never started) otherwise haunts every list forever: deactivation is
    // the right tool for someone who worked here, not for a row that should
    // never have existed.
    const purge = new URL(request.url).searchParams.get("purge") === "true";
    if (purge) {
      // Anything clinical blocks. Those relations are Restrict in the schema
      // so the database would refuse anyway — counting first turns a raw FK
      // error into something the admin can act on.
      const blockers = await countDoctorDeleteBlockers(id);
      if (blockers.total > 0) {
        return err("DoctorHasHistory", 409, {
          reason: "doctor_has_history",
          blockers,
        });
      }

      const userId = before.userId;
      const userDeactivated = await prisma.$transaction(async (tx) => {
        // A website lead is marketing, not a medical record — detach it
        // instead of letting it block the delete.
        await tx.lead.updateMany({
          where: { doctorId: id },
          data: { doctorId: null },
        });
        // Schedules, time off, presets, service links and slot snapshots are
        // Cascade in the schema — the row delete takes them along.
        await tx.doctor.delete({ where: { id } });
        // The login is useless without its doctor row (the cabinet bounces on
        // a missing profile). Deactivate rather than delete: audit rows and
        // authored records still reference this user. User is not
        // tenant-scoped, so the clinic and role are spelled out (audit
        // DR-13): a link pointed at an admin or at another clinic's login
        // must never switch that login off.
        if (userId) {
          const res = await tx.user.updateMany({
            where: { id: userId, clinicId: before.clinicId, role: "DOCTOR" },
            data: { active: false },
          });
          return res.count > 0;
        }
        return false;
      });

      await audit(request, {
        action: "doctor.delete",
        entityType: "Doctor",
        entityId: id,
        meta: { before, purged: true, userDeactivated },
      });
      return ok({ id, deleted: true });
    }

    if (!before.isActive) {
      // Already deactivated — idempotent ok.
      return ok({ id, deactivated: true });
    }

    // Refuse if any of this doctor's services would be left with zero active
    // providers after the deactivation. Services without a doctor are an
    // illegal product state per Phase 11. Shared with the PATCH path so both
    // report the same thing — including names, so the UI can say which.
    const orphaned = await findServicesOrphanedByDeactivating(id);
    if (orphaned.length > 0) {
      return err("ServiceOrphaned", 409, {
        reason: "service_orphaned",
        orphanedServiceIds: orphaned.map((s) => s.id),
        orphanedServices: orphaned,
      });
    }

    await prisma.doctor.update({
      where: { id },
      data: { isActive: false },
    });
    // Same stranded-visits warning as the PATCH path — see deactivation.ts.
    const strandedAppointments = await countStrandedAppointments(id);
    await audit(request, {
      action: "doctor.deactivate",
      entityType: "Doctor",
      entityId: id,
      meta: {
        before,
        ...(strandedAppointments > 0 ? { strandedAppointments } : {}),
      },
    });
    return ok({ id, deactivated: true, strandedAppointments });
  }
);
