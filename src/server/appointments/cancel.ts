/**
 * Single entry point for "this appointment is cancelled".
 *
 * Cross-surface sync Phase B.2 — mirrors `confirmAppointment` so every cancel
 * site (CRM DELETE handler, future mini-app self-cancel, no-show worker)
 * writes the same audit row + emits the same `appointment.cancelled`
 * envelope through the outbox.
 *
 * Caller MUST already be inside `runWithTenant({ kind: 'TENANT', clinicId })`.
 * Idempotent on second invocation: a row that's already `CANCELLED` returns
 * `{ ok: true, alreadyCancelled: true }` so duplicate clicks / re-tries from
 * inbound webhooks are safe.
 *
 * Terminal-state guard: `COMPLETED` / `NO_SHOW` rows are refused — those
 * don't belong in "cancellable" anyway. Callers translate the reason into a
 * 409 conflict (CRM) or swallow it silently (system retries).
 */

import type { Appointment } from "@/generated/prisma/client";

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
import { recomputeCaseAppointments } from "@/server/pricing/recompute-appointment-price";
import { fireTrigger } from "@/server/notifications/triggers";

export type CancelInput = {
  appointmentId: string;
  clinicId: string;
  /** Staff user id (CRM DELETE / call-center). `null` for SYSTEM (no-show
   *  worker) and PATIENT (mini-app self-cancel). */
  actorId: string | null;
  /** Free-text reason — trimmed + truncated to 500 by the caller. */
  reason?: string | null;
  /** Surface that drove the cancellation. Defaults to `CRM`. */
  surface?: Surface;
  /** Override the auto-detected actor role (CRM = RECEPTIONIST; missing
   *  actorId = SYSTEM). Useful when a PATIENT cancels via mini-app. */
  actorRole?: ActorRole;
  /** Phase M2 — when the actor IS the patient (mini-app), surface their
   *  `Patient.id` on the envelope's actor.patientId for downstream filters. */
  actorPatientId?: string | null;
  /** Phase M2 — set when the actor patient is acting on a linked relative. */
  actorOnBehalfOfPatientId?: string | null;
  /** Human-friendly label for audit/toasts. Auto-built from actor info when
   *  omitted. */
  actorLabel?: string;
  /** Cascade hint: thread upstream correlationId through. New id when omitted. */
  correlationId?: string;
  causedByEventId?: string;
};

export type CancelResult =
  | {
      ok: true;
      appointment: Appointment;
      alreadyCancelled: boolean;
      /** Pre-cancel minutes-to-appointment — surfaced for late-cancel reports. */
      lateCancelMinutes: number;
    }
  | { ok: false; reason: "not_found" | "completed" | "not_cancellable" };

export async function cancelAppointment(
  input: CancelInput,
): Promise<CancelResult> {
  const now = new Date();

  const before = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
  });
  if (!before) return { ok: false, reason: "not_found" };

  if (before.status === "COMPLETED") {
    return { ok: false, reason: "completed" };
  }

  const lateCancelMinutes = Math.max(
    0,
    Math.round((before.date.getTime() - now.getTime()) / 60_000),
  );

  // Idempotency: already cancelled → return the existing row as success.
  if (before.status === "CANCELLED" || before.status === "NO_SHOW") {
    return {
      ok: true,
      appointment: before,
      alreadyCancelled: true,
      lateCancelMinutes,
    };
  }

  const surface = input.surface ?? "CRM";
  const correlationId = input.correlationId ?? newCorrelationId();
  const actorRole: ActorRole =
    input.actorRole ?? (input.actorId ? "RECEPTIONIST" : "SYSTEM");
  const actorLabel =
    input.actorLabel ??
    (input.actorId ? `user:${input.actorId}` : `cancel:${surface.toLowerCase()}`);
  const reason = input.reason?.trim() || null;

  const { after } = await prisma.$transaction(async (tx) => {
    const after = await tx.appointment.update({
      where: { id: input.appointmentId },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelReason: reason,
      },
    });

    // Cancellation removes this visit as a candidate for the case's "first
    // visit" anchor. Reprice every sibling so the next-earliest active visit
    // flips back to full price (free-repeat now anchors on the new first).
    if (after.medicalCaseId) {
      await recomputeCaseAppointments(tx, after.medicalCaseId);
    }

    // Legacy audit row — keeps APPOINTMENT_CANCELLED reports working until
    // Phase F unifies audit through the outbox pumper. Same coexistence
    // pattern as confirmAppointment.
    await tx.auditLog.create({
      data: {
        clinicId: input.clinicId,
        actorId: input.actorId,
        actorRole: input.actorId ? null : actorRole,
        actorLabel: input.actorId ? null : actorLabel,
        action: AUDIT_ACTION.APPOINTMENT_CANCELLED,
        entityType: "Appointment",
        entityId: input.appointmentId,
        meta: {
          reason,
          lateCancelMinutes,
          statusBefore: before.status,
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
        patientId: input.actorPatientId ?? null,
        onBehalfOfPatientId: input.actorOnBehalfOfPatientId ?? null,
        label: actorLabel,
      },
      surface,
      tenantScope: {
        clinicId: input.clinicId,
        doctorId: after.doctorId ?? undefined,
        patientId: after.patientId ?? undefined,
        appointmentId: input.appointmentId,
      },
      type: "appointment.cancelled",
      payload: {
        appointmentId: input.appointmentId,
        doctorId: after.doctorId,
        patientId: after.patientId,
        cabinetId: after.cabinetId,
        status: after.status,
        date: after.date.toISOString(),
      },
    };
    await publishViaOutbox(tx, envelope);

    return { after };
  });

  // Notification trigger — separate side-effect (sends the "sorry, your
  // appointment was cancelled" SMS/TG). Outside the tx because it talks to
  // the in-process scheduler, not the DB.
  fireTrigger({ kind: "appointment.cancelled", appointmentId: after.id });

  return {
    ok: true,
    appointment: after,
    alreadyCancelled: false,
    lateCancelMinutes,
  };
}
