/**
 * /api/crm/appointments/[id]/queue-status — set queueStatus + side-effects.
 * See docs/TZ.md §6.1 queue.
 */
import type { Appointment } from "@/generated/prisma/client";
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, notFound, conflict, err } from "@/server/http";
import { QueueStatusUpdateSchema } from "@/server/schemas/appointment";
import { publishEventSafe } from "@/server/realtime/publish";
import { ticketNumberFor } from "@/server/services/ticket-number";
import { getTenant } from "@/lib/tenant-context";
import {
  canTransition,
  type AppointmentStatus,
} from "@/lib/appointment-transitions";
import {
  canRoleAdvanceTo,
  type LifecycleRole,
} from "@/lib/appointments/lifecycle";
import { confirmAppointment } from "@/server/appointments/confirm";
import { findOtherActiveVisit } from "@/server/appointments/active-visit";
import { runQueueTx } from "@/server/appointments/queue-order";
import { applyWaitingIntake } from "@/server/appointments/intake";
import { initials } from "@/lib/format";
import { sendCallNotice } from "@/server/telegram/call-notice";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../appointments/[id]/queue-status
  return parts[parts.length - 2] ?? "";
}

export const PATCH = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"],
    bodySchema: QueueStatusUpdateSchema,
  },
  async ({ request, body }) => {
    const id = idFromUrl(request);
    const before = await prisma.appointment.findUnique({ where: { id } });
    if (!before) return notFound();

    // This endpoint is the queue lifecycle: BOOKED → WAITING → IN_PROGRESS
    // → COMPLETED. Source of truth is `queueStatus`, not `status` — they
    // can drift out of sync if a row was edited through legacy paths or
    // direct DB mutation. We then re-sync both in the update below.
    const fromStatus = before.queueStatus as AppointmentStatus;
    if (
      !canTransition(fromStatus, body.queueStatus as AppointmentStatus)
    ) {
      return conflict("invalid_transition", {
        from: before.queueStatus,
        to: body.queueStatus,
      });
    }

    // Role-ownership: doctors drive IN_PROGRESS / COMPLETED, reception drives
    // the rest. Mirrors `STATE_OWNERS` in `lib/appointments/lifecycle.ts` so a
    // stale tab or scripted call can't bypass the UI gate. NURSE is already
    // excluded by `canMutateStatus` (read-only), so we only need to gate the
    // intersection where the role is otherwise permitted but the target is
    // not theirs to drive.
    const tenantPreCheck = getTenant();
    if (tenantPreCheck?.kind === "TENANT") {
      const role = tenantPreCheck.role as LifecycleRole;
      if (!canRoleAdvanceTo(role, body.queueStatus as AppointmentStatus)) {
        return err("Forbidden", 403, {
          reason: "role_cannot_advance_to",
          target: body.queueStatus,
          role,
        });
      }
    }

    // Confirmation is its own write — route through the single entry point so
    // audit + Action close + realtime fan-out stay consistent across the four
    // confirm paths (manual CRM / TG button / inbound call / booking auto-
    // confirm). The SMS-reply path was removed in `docs/TZ-sms-removal.md`
    // Wave 3. The helper handles its own audit + events; we just translate
    // its result into the route's response shape.
    if (body.queueStatus === "CONFIRMED") {
      const tenant = getTenant();
      const clinicId = tenant?.kind === "TENANT" ? tenant.clinicId : null;
      const actorId = tenant?.kind === "TENANT" ? tenant.userId : null;
      if (!clinicId) {
        return err("ClinicNotSelected", 400);
      }
      const result = await confirmAppointment({
        appointmentId: id,
        clinicId,
        actorId,
        via: "MANUAL_CRM",
      });
      if (!result.ok) {
        if (result.reason === "not_found") return notFound();
        // The specific reason ("cancelled" / "completed") is the primary one —
        // conflict() no longer lets an `extra.reason` override it, and this is
        // what already reached the wire before that hardening.
        return conflict(result.reason, {
          from: before.queueStatus,
          to: "CONFIRMED",
        });
      }
      return ok(result.appointment);
    }

    // Single active visit per doctor — same invariant as the status PATCH
    // route. Block moving a second appointment into IN_PROGRESS while this
    // doctor already has one on the table.
    if (
      body.queueStatus === "IN_PROGRESS" &&
      before.queueStatus !== "IN_PROGRESS"
    ) {
      const tenant = getTenant();
      const clinicId = tenant?.kind === "TENANT" ? tenant.clinicId : null;
      if (clinicId) {
        const active = await findOtherActiveVisit({
          clinicId,
          doctorId: before.doctorId,
          excludeAppointmentId: id,
        });
        if (active) {
          return conflict("another_visit_in_progress", {
            activeAppointmentId: active.id,
            activePatientName: active.patientName,
          });
        }
      }
    }

    const data: Record<string, unknown> = {
      queueStatus: body.queueStatus,
      status: body.queueStatus,
    };
    const now = new Date();
    if (body.queueStatus === "IN_PROGRESS" && !before.startedAt) {
      data.startedAt = now;
    }
    if (body.queueStatus === "COMPLETED" && !before.completedAt) {
      data.completedAt = now;
      // Shrink the slot if the visit ended before the originally booked end —
      // this releases the tail of the slot for walk-ins and re-bookings, and
      // makes the calendar block reflect actual occupancy. Floor at start +
      // 5 min so we never end up with a zero/negative-duration row that
      // would surprise the EXCLUDE constraint or downstream UI.
      const minEnd = new Date(before.date.getTime() + 5 * 60_000);
      const newEnd = now < minEnd ? minEnd : now;
      if (newEnd < before.endDate) {
        data.endDate = newEnd;
        data.durationMin = Math.max(
          5,
          Math.round((newEnd.getTime() - before.date.getTime()) / 60_000),
        );
      }
    }

    // The IN_PROGRESS flip decorates `queue.called` with two display fields —
    // ride them on the update instead of a follow-up read (they're stripped
    // from the response below to keep its shape flat). `telegramId` /
    // `preferredLang` / `nameRu` / `clinic` come along for the "Вас вызывают"
    // push, so the call path costs no extra round-trip.
    const callInclude = {
      patient: {
        select: {
          fullName: true,
          telegramId: true,
          preferredLang: true,
        },
      },
      doctor: {
        select: {
          nameRu: true,
          cabinet: { select: { number: true } },
        },
      },
      clinic: {
        select: {
          id: true,
          slug: true,
          tgBotToken: true,
          tgBotUsername: true,
        },
      },
    } as const;

    let after: Appointment & {
      patient?: {
        fullName: string;
        telegramId: string | null;
        preferredLang: "RU" | "UZ";
      };
      doctor?: { nameRu: string; cabinet: { number: string } | null };
      clinic?: {
        id: string;
        slug: string;
        tgBotToken: string | null;
        tgBotUsername: string | null;
      };
    };
    if (body.queueStatus === "WAITING") {
      // Reception "Пришёл" — shared intake (see `applyWaitingIntake`): claim
      // queueOrder/ticketSeq exactly once, stamp queuedAt on fresh arrival or
      // a SKIPPED return, clear startedAt on an IN_PROGRESS put-back.
      // Serializable via runQueueTx so two desks racing the same doctor can't
      // hand out a duplicate order.
      after = await runQueueTx(async (tx) => {
        Object.assign(data, await applyWaitingIntake(tx, before, now));
        return tx.appointment.update({ where: { id }, data, include: callInclude });
      });
    } else {
      after = await prisma.appointment.update({ where: { id }, data, include: callInclude });
    }
    await audit(request, {
      action: "appointment.queue-status",
      entityType: "Appointment",
      entityId: id,
      meta: { before: before.queueStatus, after: after.queueStatus },
    });

    const tenant = getTenant();
    const clinicId = tenant?.kind === "TENANT" ? tenant.clinicId : null;
    if (clinicId) {
      // `patientId` is what the mini-app SSE filter matches against
      // (`shouldDeliverV1ToMiniApp`): a v1 payload without it is dropped
      // silently, so before this the patient never learned they were called
      // from reception. Always the id off the *updated row* — never the
      // caller's context — so an event about patient A can't reach patient B.
      const patientId = after.patientId;
      publishEventSafe(clinicId, {
        type: "queue.updated",
        payload: {
          appointmentId: id,
          doctorId: after.doctorId,
          patientId,
          queueStatus: after.queueStatus,
          previousStatus: before.queueStatus,
        },
      });
      publishEventSafe(clinicId, {
        type: "appointment.statusChanged",
        payload: {
          appointmentId: id,
          doctorId: after.doctorId,
          patientId,
          status: after.status,
          previousStatus: before.status,
        },
      });
      if (after.endDate.getTime() !== before.endDate.getTime()) {
        publishEventSafe(clinicId, {
          type: "appointment.updated",
          payload: {
            appointmentId: id,
            doctorId: after.doctorId,
            patientId,
            status: after.status,
            date: after.date.toISOString(),
            endDate: after.endDate.toISOString(),
          },
        });
      }
      // Reception "Вызвать следующего" drives the patient into IN_PROGRESS
      // through this endpoint (the doctor cabinet uses the ?call=true branch
      // instead). Emit the ephemeral board signal here too so the waiting-room
      // TV chimes + flashes "now calling" regardless of which desk summoned
      // the patient. Fire-and-forget, no DB calledAt write — this is a display
      // signal, not a lifecycle change.
      if (
        body.queueStatus === "IN_PROGRESS" &&
        before.queueStatus !== "IN_PROGRESS"
      ) {
        // Deliberately no `patientId` here: `queue.called` feeds the public
        // waiting-room TV, which is why the name is reduced to initials. It is
        // not in `MINIAPP_DELIVERABLE_TYPES` — the patient's own notice rides
        // `queue.updated` + the Telegram push below.
        publishEventSafe(clinicId, {
          type: "queue.called",
          payload: {
            appointmentId: id,
            doctorId: after.doctorId,
            queueOrder: after.queueOrder,
            // Null for a booking started without check-in — no fake "X-000".
            ticketNumber: ticketNumberFor(
              after.doctorId,
              after.ticketSeq ?? after.queueOrder,
            ),
            patientName: initials(after.patient?.fullName) || undefined,
            cabinetNumber: after.doctor?.cabinet?.number ?? null,
            calledAt: now.toISOString(),
          },
        });
      }
    }

    // Same "📢 Вас вызывают" push the doctor cabinet sends — reception
    // summoning a patient is the identical event from the patient's side, and
    // a person standing in the corridor with the app closed has no other way
    // to learn about it. Awaited (not fire-and-forget) so `notificationSent`
    // in the audit trail reflects reality; `sendCallNotice` swallows its own
    // errors so a Telegram outage can't fail a committed lifecycle write.
    if (
      body.queueStatus === "IN_PROGRESS" &&
      before.queueStatus !== "IN_PROGRESS" &&
      after.clinic
    ) {
      const notificationSent = await sendCallNotice({
        clinic: after.clinic,
        telegramId: after.patient?.telegramId,
        cabinetNumber: after.doctor?.cabinet?.number ?? null,
        doctorName: after.doctor?.nameRu ?? null,
        lang: after.patient?.preferredLang ?? null,
        logTag: "appointments/queue-status",
      });
      await audit(request, {
        action: AUDIT_ACTION.APPOINTMENT_CALLED,
        entityType: "Appointment",
        entityId: id,
        meta: {
          previousStatus: before.queueStatus,
          startedVisit: true,
          notificationSent,
        },
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- rest-omit of the joined display fields (clinic carries the bot token — must never reach the wire)
    const { patient, doctor, clinic, ...flat } = after;
    return ok(flat);
  }
);
