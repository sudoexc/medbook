/**
 * Shared envelope-v2 emit helper for the appointment PATCH variants.
 *
 * Cross-surface sync Phase B.3 — the appointment PATCH route has three emit
 * blocks (revert / call / main update) that all decide between four event
 * types: `appointment.statusChanged`, `appointment.cancelled`,
 * `appointment.moved`, `appointment.updated`, plus a `queue.updated` follow-up
 * when the queue lane shifts. Each was hand-rolling the same shape with
 * `publishEventSafe`. Routing them through the outbox unlocks Last-Event-ID
 * replay and gives the audit pumper a chance to materialise a uniform row.
 *
 * Caller MUST already be inside an outer Prisma transaction so the appointment
 * write and the outbox insert commit together.
 */

import type { Appointment } from "@/generated/prisma/client";

import { publishViaOutbox, type OutboxTx } from "@/server/realtime/outbox";
import type {
  ActorRole,
  EventEnvelopeInput,
  Surface,
} from "@/server/realtime/envelope";

export type AppointmentEmitKind =
  | "cancelled"
  | "statusChanged"
  | "moved"
  | "updated";

export type EmitAppointmentChangeInput = {
  tx: OutboxTx;
  /** What kind of envelope to emit on the appointment channel. */
  kind: AppointmentEmitKind;
  /** Pre-update appointment snapshot for `previousStatus` + queue diff. */
  before: Pick<Appointment, "status" | "queueStatus">;
  /** Post-update row — payload reads doctorId/patientId/cabinetId/status/date. */
  after: Pick<
    Appointment,
    "id" | "doctorId" | "patientId" | "cabinetId" | "status" | "queueStatus" | "date"
  >;
  clinicId: string;
  actorId: string | null;
  actorRole: ActorRole;
  actorLabel: string;
  surface: Surface;
  correlationId: string;
  causedByEventId?: string;
  /** Emit a follow-up `queue.updated` envelope when the queue lane shifted. */
  alsoQueueUpdate?: boolean;
};

const kindToType: Record<AppointmentEmitKind, EventEnvelopeInput["type"]> = {
  cancelled: "appointment.cancelled",
  statusChanged: "appointment.statusChanged",
  moved: "appointment.moved",
  updated: "appointment.updated",
};

export async function emitAppointmentChangeViaOutbox(
  input: EmitAppointmentChangeInput,
): Promise<{ eventId: string }> {
  const baseEnvelope = {
    correlationId: input.correlationId,
    causedByEventId: input.causedByEventId,
    actor: {
      role: input.actorRole,
      userId: input.actorId,
      patientId: null,
      onBehalfOfPatientId: null,
      label: input.actorLabel,
    },
    surface: input.surface,
    tenantScope: {
      clinicId: input.clinicId,
      doctorId: input.after.doctorId ?? undefined,
      patientId: input.after.patientId ?? undefined,
      appointmentId: input.after.id,
    },
  } as const;

  const payload = {
    appointmentId: input.after.id,
    doctorId: input.after.doctorId,
    patientId: input.after.patientId,
    cabinetId: input.after.cabinetId,
    status: input.after.status,
    previousStatus: input.before.status,
    date: input.after.date.toISOString(),
  };

  const apptEnvelope: EventEnvelopeInput = {
    ...baseEnvelope,
    type: kindToType[input.kind],
    payload,
  };
  const { eventId } = await publishViaOutbox(input.tx, apptEnvelope);

  if (input.alsoQueueUpdate) {
    const queueEnvelope: EventEnvelopeInput = {
      ...baseEnvelope,
      causedByEventId: eventId,
      type: "queue.updated",
      payload: {
        appointmentId: input.after.id,
        doctorId: input.after.doctorId,
        queueStatus: input.after.queueStatus,
        previousStatus: input.before.queueStatus,
      },
    };
    await publishViaOutbox(input.tx, queueEnvelope);
  }

  return { eventId };
}
