/**
 * Audit G3-02 — tell every open screen that a patient's medical record
 * changed.
 *
 * Allergies, diagnoses and chronic conditions were written and audited but
 * announced to nobody. A doctor with the visit open kept a green «Конфликтов
 * не найдено» while a nurse recorded a penicillin anaphylaxis for the very
 * patient, and signed the amoxicillin; the patient card of the nurse did not
 * show the allergy the doctor had just recorded from the drug check.
 *
 * Published through the outbox in the same transaction as the write: the
 * event exists exactly when the change does, and a reconnecting screen gets
 * it replayed.
 */
import type { TenantContext } from "@/lib/tenant-context";
import type { ActorRole, Surface } from "@/server/realtime/envelope";
import type { PatientMedicalRecordChangedEventPayload } from "@/server/realtime/events";
import {
  newCorrelationId,
  publishViaOutbox,
  type OutboxTx,
} from "@/server/realtime/outbox";

type TenantCtx = Extract<TenantContext, { kind: "TENANT" }>;

/** Who wrote it: a doctor from the visit, anyone else from the CRM card. */
function actorOf(ctx: TenantCtx | null): {
  role: ActorRole;
  surface: Surface;
  userId: string | null;
} {
  if (!ctx) return { role: "SYSTEM", surface: "WORKER", userId: null };
  if (ctx.role === "DOCTOR") {
    return { role: "DOCTOR", surface: "DOCTOR_CABINET", userId: ctx.userId };
  }
  if (ctx.role === "ADMIN" || ctx.role === "SUPER_ADMIN") {
    return { role: "ADMIN", surface: "CRM", userId: ctx.userId };
  }
  // The envelope has no nurse role; nurses write from the CRM card.
  return { role: "RECEPTIONIST", surface: "CRM", userId: ctx.userId };
}

export async function publishMedicalRecordChanged(
  tx: OutboxTx,
  args: {
    ctx: TenantCtx | null;
    clinicId: string;
    payload: PatientMedicalRecordChangedEventPayload;
    correlationId?: string;
  },
): Promise<void> {
  const actor = actorOf(args.ctx);
  await publishViaOutbox(tx, {
    type: "patient.medicalRecordChanged",
    correlationId: args.correlationId ?? newCorrelationId(),
    actor: {
      role: actor.role,
      userId: actor.userId,
      patientId: null,
      onBehalfOfPatientId: null,
      label: actor.userId ? `user:${actor.userId}` : "system:medical-record",
    },
    surface: actor.surface,
    tenantScope: { clinicId: args.clinicId, patientId: args.payload.patientId },
    payload: args.payload,
  });
}
