/**
 * PATCH/DELETE /api/miniapp/appointments/[id]?clinicSlug=…
 *
 * Reschedule (startAt, doctorId?, serviceIds?) or cancel the patient's own
 * appointment. Both verbs are scoped to the authenticated patient — a
 * patient cannot touch another patient's rows.
 *
 * Phase M2 — both verbs now publish through the outbox:
 *   • cancel → delegates to shared `cancelAppointment` (Phase B.2 kernel),
 *     which emits `appointment.cancelled` + audit row.
 *   • reschedule → emits `appointment.updated` + `queue.updated` envelopes
 *     inside the same tx as the appointment row mutation.
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { conflict, err, notFound, ok } from "@/server/http";
import { createMiniAppHandler } from "@/server/miniapp/handler";
import {
  computeEndDate,
  detectConflicts,
} from "@/server/services/appointments";
import { fireTrigger } from "@/server/notifications/triggers";
import { cancelAppointment } from "@/server/appointments/cancel";
import {
  newCorrelationId,
  publishViaOutbox,
} from "@/server/realtime/outbox";
import type { EventEnvelopeInput } from "@/server/realtime/envelope";

const PatchBody = z
  .object({
    startAt: z.string().datetime().optional(),
    doctorId: z.string().optional(),
    serviceIds: z.array(z.string()).optional(),
    cancel: z.boolean().optional(),
    cancelReason: z.string().max(500).optional(),
  })
  .refine(
    (v) => v.startAt || v.doctorId || v.serviceIds || v.cancel,
    { message: "nothing_to_update" },
  );

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const PATCH = createMiniAppHandler(
  { bodySchema: PatchBody },
  async ({ request, body, ctx }) => {
    const id = idFromUrl(request);
    const before = await prisma.appointment.findFirst({
      where: { id, clinicId: ctx.clinicId, patientId: ctx.patientId },
    });
    if (!before) return notFound();
    if (
      before.status === "COMPLETED" ||
      before.status === "IN_PROGRESS" ||
      before.status === "CANCELLED"
    ) {
      return err("not_editable", 409);
    }

    if (body.cancel) {
      const result = await cancelAppointment({
        appointmentId: id,
        clinicId: ctx.clinicId,
        actorId: null,
        actorRole: "PATIENT",
        actorPatientId: ctx.patientId,
        actorLabel: `patient:${ctx.patientId}`,
        surface: "MINIAPP",
        reason: body.cancelReason ?? null,
      });
      if (!result.ok) {
        if (result.reason === "not_found") return notFound();
        if (result.reason === "completed") return err("not_editable", 409);
        return err("not_cancellable", 409);
      }
      return ok({ appointment: result.appointment });
    }

    const doctorId = body.doctorId ?? before.doctorId;
    let startAt = before.date;
    let endAt = before.endDate;
    let durationMin = before.durationMin;
    let priceBase = before.priceBase ?? 0;

    if (body.serviceIds && body.serviceIds.length > 0) {
      const services = await prisma.service.findMany({
        where: {
          id: { in: body.serviceIds },
          clinicId: ctx.clinicId,
          isActive: true,
        },
        select: { id: true, priceBase: true, durationMin: true },
      });
      if (services.length !== body.serviceIds.length) {
        return err("service_not_found", 404);
      }
      durationMin = services.reduce((a, s) => a + s.durationMin, 0) || 30;
      priceBase = services.reduce((a, s) => a + s.priceBase, 0);
    }
    if (body.startAt) {
      const next = new Date(body.startAt);
      if (Number.isNaN(next.getTime())) return err("bad_start_at", 400);
      startAt = next;
      endAt = computeEndDate(startAt, durationMin);
    } else if (body.serviceIds) {
      endAt = computeEndDate(startAt, durationMin);
    }

    const c = await detectConflicts({
      doctorId,
      cabinetId: before.cabinetId,
      startAt,
      endAt,
      excludeId: id,
    });
    if (!c.ok) {
      return conflict(c.reason, c.until ? { until: c.until } : undefined);
    }

    const time = `${String(startAt.getHours()).padStart(2, "0")}:${String(
      startAt.getMinutes(),
    ).padStart(2, "0")}`;
    const correlationId = newCorrelationId();

    const updated = await prisma.$transaction(async (tx) => {
      if (body.serviceIds) {
        await tx.appointmentService.deleteMany({
          where: { appointmentId: id },
        });
        const services = await tx.service.findMany({
          where: { id: { in: body.serviceIds } },
          select: { id: true, priceBase: true },
        });
        const priceMap = new Map(services.map((s) => [s.id, s.priceBase]));
        await tx.appointmentService.createMany({
          data: body.serviceIds.map((sid) => ({
            clinicId: ctx.clinicId,
            appointmentId: id,
            serviceId: sid,
            priceSnap: priceMap.get(sid) ?? 0,
            quantity: 1,
          })),
        });
      }
      const after = await tx.appointment.update({
        where: { id },
        data: {
          doctorId,
          serviceId: body.serviceIds?.[0] ?? before.serviceId,
          date: startAt,
          time,
          durationMin,
          endDate: endAt,
          priceBase,
          priceService: priceBase,
          priceFinal: priceBase,
        },
      });

      // Phase M2 — emit reschedule envelopes from the same tx. The
      // appointment.updated payload carries the previous date so subscribers
      // can render a "moved from → to" diff; we follow it with queue.updated
      // because the doctor's queue position may shift on a date change.
      const baseEnvelope = {
        correlationId,
        actor: {
          role: "PATIENT" as const,
          userId: null,
          patientId: ctx.patientId,
          onBehalfOfPatientId: null,
          label: `patient:${ctx.patientId}`,
        },
        surface: "MINIAPP" as const,
        tenantScope: {
          clinicId: ctx.clinicId,
          doctorId: after.doctorId,
          patientId: after.patientId,
          appointmentId: after.id,
        },
      } as const;
      const updatedEnvelope: EventEnvelopeInput = {
        ...baseEnvelope,
        type: "appointment.updated",
        payload: {
          appointmentId: after.id,
          doctorId: after.doctorId,
          patientId: after.patientId,
          cabinetId: after.cabinetId,
          status: after.status,
          date: after.date.toISOString(),
          previousDate: before.date.toISOString(),
        },
      };
      const { eventId: updatedEventId } = await publishViaOutbox(
        tx,
        updatedEnvelope,
      );
      const queueEnvelope: EventEnvelopeInput = {
        ...baseEnvelope,
        causedByEventId: updatedEventId,
        type: "queue.updated",
        payload: {
          appointmentId: after.id,
          doctorId: after.doctorId,
          queueStatus: after.queueStatus,
        },
      };
      await publishViaOutbox(tx, queueEnvelope);

      return after;
    });

    fireTrigger({ kind: "appointment.updated", appointmentId: id });
    return ok({ appointment: updated });
  },
);

export const DELETE = createMiniAppHandler({}, async ({ request, ctx }) => {
  const id = idFromUrl(request);
  const before = await prisma.appointment.findFirst({
    where: { id, clinicId: ctx.clinicId, patientId: ctx.patientId },
    select: { id: true },
  });
  if (!before) return notFound();

  // The patient may send `{ reason }` per TZ §5.3 to record WHY they cancelled.
  // The body is optional — older clients (and the detail-dialog cancel button
  // before the redesign) ship no body. We must NOT 400 on an empty body, just
  // treat it as "no reason given".
  let reason: string | null = null;
  try {
    const raw = await request.text();
    if (raw.length > 0) {
      const parsed = JSON.parse(raw) as { reason?: unknown };
      if (typeof parsed.reason === "string") {
        const trimmed = parsed.reason.trim().slice(0, 500);
        reason = trimmed.length > 0 ? trimmed : null;
      }
    }
  } catch {
    // Malformed JSON — fall through with reason=null rather than rejecting,
    // so the cancellation itself still goes through.
  }

  const result = await cancelAppointment({
    appointmentId: id,
    clinicId: ctx.clinicId,
    actorId: null,
    actorRole: "PATIENT",
    actorPatientId: ctx.patientId,
    actorLabel: `patient:${ctx.patientId}`,
    surface: "MINIAPP",
    reason,
  });
  if (!result.ok) {
    if (result.reason === "not_found") return notFound();
    if (result.reason === "completed") return err("not_editable", 409);
    return err("not_cancellable", 409);
  }
  return ok({ appointment: result.appointment });
});
