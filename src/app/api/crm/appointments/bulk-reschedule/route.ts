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
 *      success is impossible, with the single PATCH's side effects: an
 *      arrived row moved to another day is un-arrived, and every case a
 *      moved row belongs to is repriced (audit AP-16).
 */
import type { Appointment } from "@/generated/prisma/client";
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
import { tashkentComponents } from "@/lib/booking-validation";
import { emitAppointmentChangeViaOutbox } from "@/server/appointments/emit-change";
import { newCorrelationId } from "@/server/realtime/outbox";
import { fireTrigger } from "@/server/notifications/triggers";
import {
  arrivalResetOnMove,
  checkInResetOnMove,
} from "@/lib/appointments/self-check-in";
import { recomputeCaseAppointments } from "@/server/pricing/recompute-appointment-price";

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST"],
    bodySchema: BulkRescheduleSchema,
  },
  async ({ request, body, ctx }) => {
    const rows = await prisma.appointment.findMany({
      where: { id: { in: body.ids } },
      select: {
        id: true,
        status: true,
        date: true,
        endDate: true,
        doctorId: true,
        cabinetId: true,
        // Needed to build the realtime envelope for each moved row — a bulk
        // shift used to be invisible to every open patient/board surface.
        patientId: true,
        queueStatus: true,
        // Two-lanes: WALKIN rows are order-based and exempt from slot-overlap
        // checks below (their date window is technical — TZ I4).
        channel: true,
        // Moved dates can reorder a case, so its prices are recomputed.
        medicalCaseId: true,
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

    // AP-06 — a live-queue ticket is served by queue order, never by a slot,
    // so the batch refuses it like the single PATCH does and names the row.
    const walkin = rows.find((r) => r.channel === "WALKIN");
    if (walkin) {
      return conflict("walkin_locked", { id: walkin.id, field: "slot" });
    }

    const deltaMs = body.deltaMinutes * 60_000;
    const planned = rows.map((r) => ({
      id: r.id,
      doctorId: r.doctorId,
      cabinetId: r.cabinetId,
      channel: r.channel,
      patientId: r.patientId,
      status: r.status,
      queueStatus: r.queueStatus,
      medicalCaseId: r.medicalCaseId,
      oldStart: r.date,
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
        // Every row moves (delta is never 0), so a shift that lands a row
        // in the past is refused like any other move (AP-09).
        currentStartAt: cur.oldStart,
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
            // Persisted walk-ins never contend for a slot — their date window
            // is technical, the live lane is served by queue order (TZ I4).
            channel: { not: "WALKIN" },
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
              // Same walk-in exemption as the doctor clash above.
              channel: { not: "WALKIN" },
              date: { lt: cur.newEnd },
              endDate: { gt: cur.newStart },
            },
            select: { id: true },
          });
          if (cabClash && !batchById.has(cabClash.id)) {
            return conflict("cabinet_busy", { id: cur.id });
          }
        }
        // doctor_time_off / in_past / outside_schedule always block regardless
        // of batch — they're clashes with the calendar itself, not with
        // another (possibly moving) row.
        if (
          persistedConflict.reason === "doctor_time_off" ||
          persistedConflict.reason === "in_past" ||
          persistedConflict.reason === "outside_schedule"
        ) {
          return conflict(persistedConflict.reason, { id: cur.id });
        }
      }

      // Intra-batch: this row vs every later (already-sorted) row. Walk-ins
      // are exempt on either side — the live lane is FIFO by queuedAt, its
      // rows' date windows are technical and can't overlap-clash (TZ I4).
      if (cur.channel === "WALKIN") continue;
      for (let j = i + 1; j < planned.length; j++) {
        const other = planned[j];
        if (other.channel === "WALKIN") continue;
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

    // A bulk shift is a real reschedule for every row in it, so it must take
    // the same path as the single-appointment PATCH: persist, emit
    // `appointment.moved` through the outbox (atomically with the write), and
    // then re-notify the patient. Previously this route moved the times and
    // said nothing — no event, no notification — so a patient with the app
    // open still saw the old slot and the reminder cascade kept the old time.
    const correlationId = newCorrelationId();
    await prisma.$transaction(async (tx) => {
      const moved = new Map<string, { after: Appointment; unarrived: boolean }>();
      for (const p of planned) {
        // AP-16: an arrived patient moved to another day is not in that
        // day's hall, exactly as the single PATCH un-arrives him.
        const arrivalReset = arrivalResetOnMove(p.queueStatus, p.oldStart, p.newStart);
        const updated = await tx.appointment.update({
          where: { id: p.id },
          data: {
            date: p.newStart,
            endDate: p.newEnd,
            // Keep the display column in lockstep — `time` is Tashkent wall
            // clock (prod runs UTC; a bare shift would leave it stale).
            time: tashkentComponents(p.newStart).time,
            // A shift onto another clinic day drops a Mini App check-in made
            // for the old one, as the single PATCH does (review of G3-01).
            ...checkInResetOnMove(p.oldStart, p.newStart),
            ...arrivalReset,
          },
        });
        moved.set(p.id, { after: updated, unarrived: "queuedAt" in arrivalReset });
      }

      // AP-16: a moved date can change which visit of a case is the first
      // and whether a repeat still falls in the free window, so every case
      // touched is repriced once, after all its rows have moved (the single
      // PATCH does the same per move). The repriced rows are re-read so the
      // events carry the new prices.
      const caseIds = new Set(
        planned.flatMap((p) => (p.medicalCaseId ? [p.medicalCaseId] : [])),
      );
      for (const caseId of caseIds) {
        await recomputeCaseAppointments(tx, caseId);
      }
      for (const [id, entry] of moved) {
        if (!entry.after.medicalCaseId) continue;
        entry.after = await tx.appointment.findUniqueOrThrow({ where: { id } });
      }

      if (ctx.kind === "TENANT") {
        const actorUserId = ctx.userId || null;
        for (const p of planned) {
          const entry = moved.get(p.id);
          if (!entry) continue;
          await emitAppointmentChangeViaOutbox({
            tx,
            kind: "moved",
            before: { status: p.status, queueStatus: p.queueStatus },
            after: entry.after,
            clinicId: ctx.clinicId,
            actorId: actorUserId,
            actorRole: ctx.role === "DOCTOR" ? "DOCTOR" : "RECEPTIONIST",
            actorLabel: actorUserId ? `user:${actorUserId}` : "user:anonymous",
            surface: ctx.role === "DOCTOR" ? "DOCTOR_CABINET" : "CRM",
            correlationId,
            // The un-arrived row leaves today's queue: boards must drop it.
            alsoQueueUpdate: entry.unarrived,
          });
        }
      }
    });

    // Best-effort, post-commit: cancel the now-stale reminders and rebuild the
    // cascade around each new start. Fire-and-forget by contract — a trigger
    // failure must never fail an already-committed reschedule.
    for (const p of planned) {
      fireTrigger({ kind: "appointment.rescheduled", appointmentId: p.id });
    }

    // No «Перенести» outcome here (audit AC-10): a shift of the doctor's day
    // is not a call to each patient. Their open risk rows follow the visits
    // on the engine's next pass; only a move saved from the risk-today row
    // records the outcome (`recordRescheduleOutcome`).

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
