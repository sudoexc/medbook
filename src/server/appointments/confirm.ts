/**
 * Single entry point for "this appointment is now confirmed".
 *
 * Called from FIVE places — reception UI (queue-status PATCH), SMS reply
 * webhook, Telegram callback handler, inbound call (callcenter manual flip),
 * and the create route's auto-confirm fast-path for PHONE/KIOSK channels.
 * Centralising the write keeps the audit log uniform, guarantees the
 * confirm-call Actions get closed exactly once per appointment, and emits
 * one realtime event so calendar/reception/action-center all repaint
 * together.
 *
 * Caller MUST already be inside `runWithTenant({ kind: 'TENANT', clinicId })`.
 * The function trusts the tenant context to scope the Prisma writes and
 * does not re-check clinic ownership of the appointment id.
 */

import type { Appointment, ConfirmationVia } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import { dedupeKeyFor } from "@/lib/actions/types";
import { publishEventSafe } from "@/server/realtime/publish";
import { AUDIT_ACTION } from "@/lib/audit-actions";

export type ConfirmInput = {
  appointmentId: string;
  clinicId: string;
  /** ID of the staff member who flipped the row. Null for patient-initiated
   *  paths (SMS_REPLY / TG_BUTTON) and for BOOKING_AUTO. */
  actorId: string | null;
  via: ConfirmationVia;
};

export type ConfirmResult =
  | { ok: true; appointment: Appointment; alreadyConfirmed: boolean }
  | { ok: false; reason: "not_found" | "cancelled" | "completed" };

/**
 * Idempotent: a second call for the same appointment is a no-op (returns
 * `alreadyConfirmed: true`). Callers can treat that as success and avoid
 * special-casing duplicate webhooks / double-clicks.
 *
 * On terminal states (CANCELLED, NO_SHOW, COMPLETED) we refuse the flip —
 * those appointments don't belong in "to be confirmed" anyway. The caller
 * should surface the reason to the user (or just swallow for webhooks).
 */
export async function confirmAppointment(
  input: ConfirmInput,
): Promise<ConfirmResult> {
  const now = new Date();

  const before = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    select: {
      id: true,
      status: true,
      queueStatus: true,
      confirmedAt: true,
      doctorId: true,
      date: true,
    },
  });
  if (!before) return { ok: false, reason: "not_found" };
  if (before.status === "CANCELLED" || before.status === "NO_SHOW") {
    return { ok: false, reason: "cancelled" };
  }
  if (before.status === "COMPLETED") {
    return { ok: false, reason: "completed" };
  }

  // Idempotency: if already confirmed, just close any stale confirm-call
  // Actions (defensive — usually closed at first flip) and return early.
  if (before.confirmedAt) {
    await closeOpenConfirmActions(input.clinicId, input.appointmentId, now);
    const fresh = await prisma.appointment.findUnique({
      where: { id: input.appointmentId },
    });
    return { ok: true, appointment: fresh!, alreadyConfirmed: true };
  }

  // Once-WAITING-or-later appointments shouldn't drop back to CONFIRMED in
  // either column; record the confirmation timestamp but leave status/queueStatus
  // alone. This covers a walk-in who texted YES after the front desk already
  // moved them to WAITING — we still want the audit trail.
  const shouldFlipStatus =
    before.status === "BOOKED" && before.queueStatus === "BOOKED";

  const after = await prisma.appointment.update({
    where: { id: input.appointmentId },
    data: {
      confirmedAt: now,
      confirmedBy: input.actorId,
      confirmedVia: input.via,
      ...(shouldFlipStatus
        ? { status: "CONFIRMED", queueStatus: "CONFIRMED" }
        : {}),
    },
  });

  await closeOpenConfirmActions(input.clinicId, input.appointmentId, now);

  // Audit. We write directly (not via the request-scoped `audit()` helper)
  // because webhook paths have no request session.
  await prisma.auditLog.create({
    data: {
      clinicId: input.clinicId,
      actorId: input.actorId,
      actorRole: input.actorId ? null : "SYSTEM",
      actorLabel: input.actorId ? null : `confirm:${input.via}`,
      action: AUDIT_ACTION.APPOINTMENT_CONFIRMED,
      entityType: "Appointment",
      entityId: input.appointmentId,
      meta: {
        via: input.via,
        statusBefore: before.status,
        statusAfter: after.status,
        statusFlipped: shouldFlipStatus,
      } as never,
      ip: null,
      userAgent: null,
    },
  });

  // Realtime fan-out: calendar tile recolor, reception queue pill update,
  // action-center row removal. We emit two events because consumers split
  // on the kind — `queue.updated` drives the doctor-queue panel, while
  // `appointment.statusChanged` drives the appointments list & detail.
  publishEventSafe(input.clinicId, {
    type: "queue.updated",
    payload: {
      appointmentId: input.appointmentId,
      doctorId: after.doctorId,
      queueStatus: after.queueStatus,
      previousStatus: before.queueStatus,
    },
  });
  publishEventSafe(input.clinicId, {
    type: "appointment.statusChanged",
    payload: {
      appointmentId: input.appointmentId,
      doctorId: after.doctorId,
      status: after.status,
      previousStatus: before.status,
    },
  });

  return { ok: true, appointment: after, alreadyConfirmed: false };
}

/**
 * Close any OPEN/SNOOZED `UNCONFIRMED_24H` Actions for this appointment.
 * Idempotent — re-running on an already-closed row is a no-op.
 *
 * We close instead of delete so the audit trail survives ("staff called at
 * 14:02, patient confirmed; task auto-closed at 14:05").
 */
async function closeOpenConfirmActions(
  clinicId: string,
  appointmentId: string,
  now: Date,
): Promise<void> {
  // Mirror the detector's dedupe-key construction so we close exactly the
  // row the detector would have upserted. Build the key from a payload stub
  // so a future detector rename can't desync the two paths.
  const dedupeKey = dedupeKeyFor({
    type: "UNCONFIRMED_24H",
    appointmentId,
    // The remaining fields are not part of the dedupe key — `dedupeKeyFor`
    // only reads `type` + `appointmentId` for this variant.
    patientId: "",
    patientName: "",
    appointmentAt: "",
    doctorName: "",
  });

  await prisma.action.updateMany({
    where: {
      clinicId,
      dedupeKey,
      status: { in: ["OPEN", "SNOOZED"] },
    },
    data: { status: "DONE", doneAt: now },
  });
}
