/**
 * /api/crm/appointments/[id]/queue-status — set queueStatus + side-effects.
 * See docs/TZ.md §6.1 queue.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
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
        return conflict("invalid_transition", {
          from: before.queueStatus,
          to: "CONFIRMED",
          reason: result.reason,
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

    const after = await prisma.appointment.update({ where: { id }, data });
    await audit(request, {
      action: "appointment.queue-status",
      entityType: "Appointment",
      entityId: id,
      meta: { before: before.queueStatus, after: after.queueStatus },
    });

    const tenant = getTenant();
    const clinicId = tenant?.kind === "TENANT" ? tenant.clinicId : null;
    if (clinicId) {
      publishEventSafe(clinicId, {
        type: "queue.updated",
        payload: {
          appointmentId: id,
          doctorId: after.doctorId,
          queueStatus: after.queueStatus,
          previousStatus: before.queueStatus,
        },
      });
      publishEventSafe(clinicId, {
        type: "appointment.statusChanged",
        payload: {
          appointmentId: id,
          doctorId: after.doctorId,
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
        const doctorCabinet = await prisma.doctor.findUnique({
          where: { id: after.doctorId },
          select: { cabinet: { select: { number: true } } },
        });
        publishEventSafe(clinicId, {
          type: "queue.called",
          payload: {
            appointmentId: id,
            doctorId: after.doctorId,
            queueOrder: after.queueOrder,
            ticketNumber: ticketNumberFor(
              after.doctorId,
              after.ticketSeq ?? after.queueOrder,
            ),
            cabinetNumber: doctorCabinet?.cabinet?.number ?? null,
            calledAt: now.toISOString(),
          },
        });
      }
    }
    return ok(after);
  }
);
