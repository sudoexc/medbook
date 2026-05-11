/**
 * /api/crm/appointments/bulk-reschedule — shift many appointments by a delta.
 *
 * Body: { ids: string[], deltaMinutes: number }
 *
 * Algorithm:
 *   1. Load all selected appointments (status + times + doctor/cabinet).
 *   2. Refuse the batch if any row has a status that disallows rescheduling
 *      (only BOOKED / WAITING / SKIPPED can be shifted).
 *   3. Compute new (startAt, endAt) for each row by adding deltaMinutes.
 *   4. Run detectConflicts per row (excluding itself) — including against the
 *      other rows in the same batch by sequencing conflict checks against a
 *      virtual schedule that already includes the new positions of earlier
 *      rows in the same call.
 *   5. If ANY conflict, return 409 with the offending row + reason.
 *   6. Otherwise persist all updates in a single transaction so partial
 *      success is impossible.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, conflict } from "@/server/http";
import { BulkRescheduleSchema } from "@/server/schemas/appointment";
import {
  actionsFor,
  type AppointmentStatus,
} from "@/lib/appointment-transitions";
import { detectConflicts } from "@/server/services/appointments";

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST"],
    bodySchema: BulkRescheduleSchema,
  },
  async ({ request, body }) => {
    const rows = await prisma.appointment.findMany({
      where: { id: { in: body.ids } },
      select: {
        id: true,
        status: true,
        date: true,
        endDate: true,
        doctorId: true,
        cabinetId: true,
      },
    });

    if (rows.length === 0) {
      return conflict("invalid_transition", { ids: body.ids });
    }

    const blockedByStatus = rows.find(
      (r) => !actionsFor(r.status as AppointmentStatus).canReschedule,
    );
    if (blockedByStatus) {
      return conflict("invalid_transition", {
        id: blockedByStatus.id,
        status: blockedByStatus.status,
      });
    }

    const deltaMs = body.deltaMinutes * 60_000;
    const planned = rows.map((r) => ({
      id: r.id,
      doctorId: r.doctorId,
      cabinetId: r.cabinetId,
      newStart: new Date(r.date.getTime() + deltaMs),
      newEnd: new Date(r.endDate.getTime() + deltaMs),
    }));

    // Order by new start time so per-pair overlap checks within the batch
    // run deterministically. Conflict detection against persisted rows runs
    // through detectConflicts; intra-batch conflicts are checked manually.
    planned.sort((a, b) => a.newStart.getTime() - b.newStart.getTime());

    const batchById = new Set(planned.map((p) => p.id));
    for (let i = 0; i < planned.length; i++) {
      const cur = planned[i];
      // Persisted-row conflict — exclude every id in the batch so we only
      // compare against rows that are NOT moving.
      const persistedConflict = await detectConflicts({
        doctorId: cur.doctorId,
        cabinetId: cur.cabinetId,
        startAt: cur.newStart,
        endAt: cur.newEnd,
        excludeId: cur.id,
      });
      if (!persistedConflict.ok) {
        // detectConflicts excludes a single id — if the conflict it found is
        // another row in the same batch, ignore (we'll catch via intra-batch
        // check below). Otherwise it's a genuine clash with a row not moving.
        // Re-query to confirm the conflicting row is not in our batch.
        const clash = await prisma.appointment.findFirst({
          where: {
            doctorId: cur.doctorId,
            id: { not: cur.id },
            status: { notIn: ["CANCELLED", "NO_SHOW"] },
            date: { lt: cur.newEnd },
            endDate: { gt: cur.newStart },
          },
          select: { id: true, endDate: true },
        });
        if (clash && !batchById.has(clash.id)) {
          return conflict(persistedConflict.reason, {
            id: cur.id,
            ...(persistedConflict.until
              ? { until: persistedConflict.until }
              : {}),
          });
        }
        // Cabinet check the same way if present.
        if (cur.cabinetId && persistedConflict.reason === "cabinet_busy") {
          const cabClash = await prisma.appointment.findFirst({
            where: {
              cabinetId: cur.cabinetId,
              id: { not: cur.id },
              status: { notIn: ["CANCELLED", "NO_SHOW"] },
              date: { lt: cur.newEnd },
              endDate: { gt: cur.newStart },
            },
            select: { id: true },
          });
          if (cabClash && !batchById.has(cabClash.id)) {
            return conflict("cabinet_busy", { id: cur.id });
          }
        }
        // doctor_time_off and in_past always block regardless of batch.
        if (
          persistedConflict.reason === "doctor_time_off" ||
          persistedConflict.reason === "in_past"
        ) {
          return conflict(persistedConflict.reason, { id: cur.id });
        }
      }

      // Intra-batch: this row vs every later (already-sorted) row.
      for (let j = i + 1; j < planned.length; j++) {
        const other = planned[j];
        const sameDoctor = other.doctorId === cur.doctorId;
        const sameCab =
          cur.cabinetId !== null && other.cabinetId === cur.cabinetId;
        if (!sameDoctor && !sameCab) continue;
        const overlap =
          cur.newStart < other.newEnd && other.newStart < cur.newEnd;
        if (overlap) {
          return conflict(sameDoctor ? "doctor_busy" : "cabinet_busy", {
            id: cur.id,
            otherId: other.id,
          });
        }
      }
    }

    await prisma.$transaction(
      planned.map((p) =>
        prisma.appointment.update({
          where: { id: p.id },
          data: { date: p.newStart, endDate: p.newEnd },
        }),
      ),
    );

    await audit(request, {
      action: "appointment.bulk-reschedule",
      entityType: "Appointment",
      meta: {
        ids: body.ids,
        deltaMinutes: body.deltaMinutes,
        count: planned.length,
      },
    });

    return ok({ count: planned.length, ids: planned.map((p) => p.id) });
  },
);
