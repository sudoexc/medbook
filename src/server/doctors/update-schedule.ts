/**
 * Single entry point for "replace this doctor's weekly schedule".
 *
 * Cross-surface sync §7.7 — the PUT /doctors/[id]/schedule handler used to
 * run a bare 2-step transaction (deleteMany + createMany) and a post-tx
 * `audit()` call. The mini-app slot picker only saw schedule edits on the
 * next manual refetch, the CRM calendar's slot grid was equally stale, and
 * the audit trail had no envelope/correlationId for cross-surface trace.
 *
 * The kernel:
 *   1. Counts the existing schedule rows for the `previousEntryCount` delta.
 *   2. Replaces all rows atomically (deleteMany + createMany inside one tx).
 *   3. Writes the legacy `DOCTOR_SCHEDULE_REPLACED` audit row — coexistence
 *      pattern, kept until Phase F unifies audit through the outbox pumper.
 *   4. Emits `doctor.scheduleChanged` envelope through the outbox so the
 *      mini-app slots query keys, the CRM calendar, and the doctor cabinet
 *      `/schedule` page all refetch live.
 *
 * Caller is responsible for input validation (overlap detection, weekday
 * range, time format). The kernel trusts its inputs.
 */

import { prisma } from "@/lib/prisma";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import {
  newCorrelationId,
  publishViaOutbox,
} from "@/server/realtime/outbox";
import type {
  ActorRole,
  EventEnvelopeInput,
  Surface,
} from "@/server/realtime/envelope";

export type ScheduleEntryInput = {
  weekday: number;
  startTime: string;
  endTime: string;
  validFrom?: Date | null;
  validTo?: Date | null;
  isActive?: boolean;
};

export type UpdateDoctorScheduleInput = {
  clinicId: string;
  doctorId: string;
  entries: ScheduleEntryInput[];
  actorId: string | null;
  actorRole?: ActorRole;
  actorLabel?: string;
  surface?: Surface;
  correlationId?: string;
  causedByEventId?: string;
};

export type UpdateDoctorScheduleResult = {
  entryCount: number;
  previousEntryCount: number;
};

export async function updateDoctorSchedule(
  input: UpdateDoctorScheduleInput,
): Promise<UpdateDoctorScheduleResult> {
  const surface = input.surface ?? "CRM";
  const correlationId = input.correlationId ?? newCorrelationId();
  const actorRole: ActorRole =
    input.actorRole ?? (input.actorId ? "DOCTOR" : "SYSTEM");
  const actorLabel =
    input.actorLabel ??
    (input.actorId
      ? `user:${input.actorId}`
      : `schedule-update:${surface.toLowerCase()}`);

  const result = await prisma.$transaction(async (tx) => {
    const previousEntryCount = await tx.doctorSchedule.count({
      where: { doctorId: input.doctorId },
    });

    await tx.doctorSchedule.deleteMany({
      where: { doctorId: input.doctorId },
    });

    if (input.entries.length > 0) {
      await tx.doctorSchedule.createMany({
        data: input.entries.map((e) => ({
          doctorId: input.doctorId,
          weekday: e.weekday,
          startTime: e.startTime,
          endTime: e.endTime,
          validFrom: e.validFrom ?? null,
          validTo: e.validTo ?? null,
          isActive: e.isActive ?? true,
        })) as never,
      });
    }

    const entryCount = input.entries.length;

    await tx.auditLog.create({
      data: {
        clinicId: input.clinicId,
        actorId: input.actorId,
        actorRole: input.actorId ? null : actorRole,
        actorLabel: input.actorId ? null : actorLabel,
        action: AUDIT_ACTION.DOCTOR_SCHEDULE_REPLACED,
        entityType: "Doctor",
        entityId: input.doctorId,
        meta: {
          entryCount,
          previousEntryCount,
          correlationId,
        } as never,
        ip: null,
        userAgent: null,
        surface,
        correlationId,
      },
    });

    const envelope: EventEnvelopeInput = {
      correlationId,
      causedByEventId: input.causedByEventId,
      actor: {
        role: actorRole,
        userId: input.actorId,
        patientId: null,
        onBehalfOfPatientId: null,
        label: actorLabel,
      },
      surface,
      tenantScope: {
        clinicId: input.clinicId,
        doctorId: input.doctorId,
      },
      type: "doctor.scheduleChanged",
      payload: {
        doctorId: input.doctorId,
        entryCount,
        previousEntryCount,
      },
    };
    await publishViaOutbox(tx, envelope);

    return { entryCount, previousEntryCount };
  });

  return result;
}
