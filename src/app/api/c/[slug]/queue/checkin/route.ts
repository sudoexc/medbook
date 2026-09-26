/**
 * POST /api/c/[slug]/queue/checkin
 *
 * Kiosk endpoint: mark an existing appointment as WAITING (in-clinic
 * queue) and assign it a queueOrder. Returns ticket payload for printing.
 *
 * Same intake as reception's «Пришёл» (`applyWaitingIntake`), and `status`
 * moves together with `queueStatus`: the NO_SHOW sweep reads `status`, so a
 * CONFIRMED booking that got a ticket but kept `status=CONFIRMED` was later
 * swept as a no-show while the patient sat in the hall (audit Q-01).
 *
 * Answers only to the clinic's paired kiosk (`x-kiosk-token`, audit SEC-01):
 * the slug is public, and anyone could otherwise mark patients «arrived».
 *
 * Body: { appointmentId: string }
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { tashkentDayBounds } from "@/lib/booking-validation";
import { ok, err } from "@/server/http";
import { resolvePublicClinic } from "@/server/clinic-public/resolve";
import { rateLimit } from "@/lib/rate-limit";
import {
  maskPatientName,
  realClientIp,
  requireKioskFor,
} from "@/server/kiosk/device";
import { runWithTenant } from "@/lib/tenant-context";
import { publishEventSafe } from "@/server/realtime/publish";
import { ticketNumberFor } from "@/server/services/ticket-number";
import { runQueueTx } from "@/server/appointments/queue-order";
import { applyWaitingIntake } from "@/server/appointments/intake";
import { kioskCheckinEntersQueue } from "@/server/kiosk/checkin-statuses";

const Body = z.object({ appointmentId: z.string().min(1) });

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const resolved = await resolvePublicClinic(request);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const kiosk = await requireKioskFor(request, ctx.clinicSlug);
  if (!kiosk.ok) return kiosk.response;
  if (!rateLimit(`kiosk-checkin:${ctx.clinicId}:${realClientIp(request)}`, 30)) {
    return err("too_many_requests", 429);
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return err("bad_body", 400);
  }

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const appt = await prisma.appointment.findFirst({
      where: { id: parsed.appointmentId, clinicId: ctx.clinicId },
      select: {
        id: true,
        clinicId: true,
        doctorId: true,
        patientId: true,
        date: true,
        time: true,
        status: true,
        queueStatus: true,
        queueOrder: true,
        ticketSeq: true,
        queuedAt: true,
        ticketCode: true,
        patient: { select: { id: true, fullName: true } },
        doctor: {
          select: {
            id: true,
            nameRu: true,
            nameUz: true,
            color: true,
            ticketPrefix: true,
            cabinet: { select: { number: true } },
          },
        },
      },
    });
    if (!appt) return err("not_found", 404);

    // Only allow checkin for today's appointments (Tashkent wall-clock day).
    const { dayStart, dayEnd } = tashkentDayBounds();
    if (appt.date < dayStart || appt.date >= dayEnd) {
      return err("not_today", 400);
    }
    if (
      appt.queueStatus === "CANCELLED" ||
      appt.queueStatus === "NO_SHOW" ||
      appt.queueStatus === "COMPLETED"
    ) {
      return err("not_eligible", 400);
    }

    // A booking (BOOKED / CONFIRMED) or a skipped patient coming back
    // enters the live queue: shared intake claims queueOrder/ticketSeq once
    // and stamps queuedAt, exactly like reception's «Пришёл». Both status
    // columns flip together. A row already WAITING / IN_PROGRESS is a second
    // tap: reprint the same ticket, except a legacy WAITING row that never
    // got a number, which the intake numbers now. Serializable (runQueueTx)
    // so two kiosks, or kiosk + reception, can't hand out the same number.
    const entering = kioskCheckinEntersQueue(appt.queueStatus);
    const needsNumber = appt.queueStatus === "WAITING" && appt.queueOrder == null;
    const now = new Date();
    const updated =
      entering || needsNumber
        ? await runQueueTx(async (tx) => {
            const intake = await applyWaitingIntake(tx, appt, now);
            return tx.appointment.update({
              where: { id: appt.id },
              data: {
                ...intake,
                ...(entering
                  ? { queueStatus: "WAITING" as const, status: "WAITING" as const }
                  : {}),
              },
              select: {
                queueStatus: true,
                status: true,
                queueOrder: true,
                ticketSeq: true,
              },
            });
          })
        : {
            queueStatus: appt.queueStatus,
            status: appt.status,
            queueOrder: appt.queueOrder,
            ticketSeq: appt.ticketSeq,
          };
    const queueOrder = updated.queueOrder;
    const ticketSeq = updated.ticketSeq;

    if (entering || needsNumber) {
      publishEventSafe(ctx.clinicId, {
        type: "queue.updated",
        payload: {
          appointmentId: appt.id,
          doctorId: appt.doctorId,
          patientId: appt.patientId,
          queueStatus: updated.queueStatus,
          previousStatus: appt.queueStatus,
        },
      });
    }
    if (entering) {
      // Reception's list shows the row's `status` («Пришёл»); without this
      // poke it kept showing the booking as expected until a reload.
      publishEventSafe(ctx.clinicId, {
        type: "appointment.statusChanged",
        payload: {
          appointmentId: appt.id,
          doctorId: appt.doctorId,
          patientId: appt.patientId,
          status: updated.status,
          previousStatus: appt.status,
        },
      });
    }

    const cabinetNumber = appt.doctor.cabinet?.number ?? null;

    return ok({
      appointmentId: appt.id,
      ticketCode: appt.ticketCode,
      ticketNumber: ticketNumberFor(appt.doctor, ticketSeq ?? queueOrder),
      queueOrder,
      patient: {
        id: appt.patient.id,
        fullName: maskPatientName(appt.patient.fullName),
      },
      doctor: {
        id: appt.doctor.id,
        nameRu: appt.doctor.nameRu,
        nameUz: appt.doctor.nameUz,
        color: appt.doctor.color,
      },
      cabinet: cabinetNumber,
    });
  });
}
