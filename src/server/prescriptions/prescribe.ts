/**
 * Single entry point for "write a medication regimen for this patient".
 *
 * Cross-surface sync §7.11 — the case-scoped POST handler used to do a bare
 * `prisma.prescription.create` + post-tx `audit()` call, and nothing else.
 * The mini-app `/medications` page only saw new prescriptions on the next
 * manual refresh, and the audit trail had no envelope/correlationId for
 * cross-surface trace.
 *
 * The kernel:
 *   1. Encrypts `notes` via the existing cipher boundary so PII never
 *      reaches the row at rest.
 *   2. Creates the `Prescription` row.
 *   3. Writes the legacy `PRESCRIPTION_CREATED` audit row (kept until Phase
 *      F unifies audit through the outbox pumper — same coexistence pattern
 *      as `cancelAppointment` / `confirmAppointment`).
 *   4. Emits a `prescription.created` envelope through the outbox so the
 *      mini-app `/medications` SSE subscriber + CRM case-detail card both
 *      refresh live.
 *
 * Caller MUST already have validated authz (clinic match, doctor exists,
 * case belongs to clinic) — the kernel trusts its inputs.
 */

import type { Prescription } from "@/generated/prisma/client";

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
import {
  hydratePrescriptionForRead,
  serializePrescriptionForWrite,
} from "@/server/prescription/cipher-fields";

export type PrescribeMedicationInput = {
  clinicId: string;
  caseId: string;
  patientId: string;
  doctorId: string;
  drugName: string;
  dosage: string;
  schedule: {
    times: string[];
    days: number | null;
    startsAt: string;
  };
  notes?: string | null;
  remindersEnabled?: boolean;
  status?: "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
  /** Staff `User.id` that initiated the write. `null` for SYSTEM. */
  actorId: string | null;
  actorRole?: ActorRole;
  actorLabel?: string;
  surface?: Surface;
  correlationId?: string;
  causedByEventId?: string;
};

export type PrescribeMedicationResult = {
  prescription: Prescription;
};

export async function prescribeMedication(
  input: PrescribeMedicationInput,
): Promise<PrescribeMedicationResult> {
  const surface = input.surface ?? "DOCTOR_CABINET";
  const correlationId = input.correlationId ?? newCorrelationId();
  const actorRole: ActorRole =
    input.actorRole ?? (input.actorId ? "DOCTOR" : "SYSTEM");
  const actorLabel =
    input.actorLabel ??
    (input.actorId ? `user:${input.actorId}` : `prescribe:${surface.toLowerCase()}`);

  const writeData = serializePrescriptionForWrite({
    clinicId: input.clinicId,
    caseId: input.caseId,
    patientId: input.patientId,
    doctorId: input.doctorId,
    drugName: input.drugName,
    dosage: input.dosage,
    schedule: input.schedule,
    notes: input.notes ?? null,
    remindersEnabled: input.remindersEnabled ?? false,
    status: input.status ?? "ACTIVE",
  } as never);

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.prescription.create({
      data: writeData as never,
    });

    await tx.auditLog.create({
      data: {
        clinicId: input.clinicId,
        actorId: input.actorId,
        actorRole: input.actorId ? null : actorRole,
        actorLabel: input.actorId ? null : actorLabel,
        action: AUDIT_ACTION.PRESCRIPTION_CREATED,
        entityType: "Prescription",
        entityId: row.id,
        meta: {
          caseId: input.caseId,
          patientId: input.patientId,
          drugName: row.drugName,
          scheduleTimes: input.schedule.times,
          days: input.schedule.days,
          remindersEnabled: row.remindersEnabled,
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
        patientId: input.patientId,
      },
      type: "prescription.created",
      payload: {
        prescriptionId: row.id,
        patientId: input.patientId,
        doctorId: input.doctorId,
        caseId: input.caseId,
        drugName: row.drugName,
        dosage: row.dosage,
        remindersEnabled: row.remindersEnabled,
        status: row.status,
      },
    };
    await publishViaOutbox(tx, envelope);

    return row;
  });

  // Decrypt notes back to plaintext for the caller before returning. The
  // stored row keeps the ciphertext; only the in-flight response object is
  // hydrated.
  return { prescription: hydratePrescriptionForRead(created) };
}
