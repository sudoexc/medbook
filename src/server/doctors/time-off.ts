/**
 * Doctor time off: create / remove an absence window (audit DR-06).
 *
 * The route used to insert the row and stop there. Two things went missing:
 *
 *   1. The visits already booked inside the window stayed on the books,
 *      reminders kept going out, and patients came to a doctor on leave;
 *      nobody told the admin. The create now answers with how many active
 *      visits fall inside the window (and the span they cover) so the UI can
 *      warn loudly and send the admin to reschedule them. It never cancels
 *      or moves anything by itself: that is a decision with a patient on the
 *      other end.
 *   2. Open Mini Apps and the CRM slot grids kept offering the vacation days
 *      until a reload. Both create and delete now emit
 *      `doctor.scheduleChanged` through the outbox, like a weekly schedule
 *      edit does (`update-schedule.ts`), in the same transaction as the row.
 */
import { prisma } from "@/lib/prisma";
import { UPCOMING_VISIT_STATUSES } from "@/lib/appointments/active-statuses";
import {
  newCorrelationId,
  publishViaOutbox,
  type OutboxTx,
} from "@/server/realtime/outbox";
import type { ActorRole, Surface } from "@/server/realtime/envelope";

export type TimeOffActor = {
  actorId: string | null;
  actorRole: ActorRole;
  surface: Surface;
};

/** Active visits of the doctor that overlap the window. */
export type TimeOffAffected = {
  count: number;
  /** Start of the earliest overlapping visit, ISO; null when none. */
  firstAt: string | null;
  /** Start of the latest overlapping visit, ISO; null when none. */
  lastAt: string | null;
};

/**
 * Visits still expected inside [startAt, endAt): booked, confirmed or
 * waiting. Half-open like the overlap constraint, so a visit ending exactly
 * when the leave starts is not in the way.
 */
export function timeOffOverlapWhere(
  doctorId: string,
  startAt: Date,
  endAt: Date,
) {
  return {
    doctorId,
    status: { in: [...UPCOMING_VISIT_STATUSES] },
    date: { lt: endAt },
    endDate: { gt: startAt },
  };
}

async function emitScheduleChanged(
  tx: OutboxTx,
  args: {
    clinicId: string;
    doctorId: string;
    actor: TimeOffActor;
    timeOff: { id: string; startAt: Date; endAt: Date };
    change: "timeOffCreated" | "timeOffDeleted";
  },
): Promise<void> {
  // The weekly rows did not change; the payload still carries their count
  // because the event contract requires it, plus what did change.
  const entryCount = await (tx as typeof prisma).doctorSchedule.count({
    where: { doctorId: args.doctorId },
  });
  await publishViaOutbox(tx, {
    correlationId: newCorrelationId(),
    actor: {
      role: args.actor.actorRole,
      userId: args.actor.actorId,
      patientId: null,
      onBehalfOfPatientId: null,
      label: args.actor.actorId
        ? `user:${args.actor.actorId}`
        : `time-off:${args.actor.surface.toLowerCase()}`,
    },
    surface: args.actor.surface,
    tenantScope: { clinicId: args.clinicId, doctorId: args.doctorId },
    type: "doctor.scheduleChanged",
    payload: {
      doctorId: args.doctorId,
      entryCount,
      previousEntryCount: entryCount,
      change: args.change,
      timeOffId: args.timeOff.id,
      startAt: args.timeOff.startAt.toISOString(),
      endAt: args.timeOff.endAt.toISOString(),
    },
  });
}

export async function createDoctorTimeOff(input: {
  clinicId: string;
  doctorId: string;
  startAt: Date;
  endAt: Date;
  reason: string | null;
  actor: TimeOffActor;
}) {
  return prisma.$transaction(async (tx) => {
    const created = await tx.doctorTimeOff.create({
      data: {
        doctorId: input.doctorId,
        startAt: input.startAt,
        endAt: input.endAt,
        reason: input.reason,
      } as never,
    });
    const where = timeOffOverlapWhere(input.doctorId, input.startAt, input.endAt);
    const [count, first, last] = await Promise.all([
      tx.appointment.count({ where }),
      tx.appointment.findFirst({
        where,
        orderBy: { date: "asc" },
        select: { date: true },
      }),
      tx.appointment.findFirst({
        where,
        orderBy: { date: "desc" },
        select: { date: true },
      }),
    ]);
    await emitScheduleChanged(tx, {
      clinicId: input.clinicId,
      doctorId: input.doctorId,
      actor: input.actor,
      timeOff: created,
      change: "timeOffCreated",
    });
    const affected: TimeOffAffected = {
      count,
      firstAt: first?.date.toISOString() ?? null,
      lastAt: last?.date.toISOString() ?? null,
    };
    return { created, affected };
  });
}

/**
 * Remove one window of THIS doctor. Scoped by doctorId as well as the id:
 * the entry id comes from the query string, and a doctor may only remove
 * his own leave. Returns false when nothing matched.
 */
export async function deleteDoctorTimeOff(input: {
  clinicId: string;
  doctorId: string;
  entryId: string;
  actor: TimeOffActor;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.doctorTimeOff.findFirst({
      where: { id: input.entryId, doctorId: input.doctorId },
      select: { id: true, startAt: true, endAt: true },
    });
    if (!row) return false;
    await tx.doctorTimeOff.delete({ where: { id: row.id } });
    await emitScheduleChanged(tx, {
      clinicId: input.clinicId,
      doctorId: input.doctorId,
      actor: input.actor,
      timeOff: row,
      change: "timeOffDeleted",
    });
    return true;
  });
}
