/**
 * POST /api/c/[slug]/queue/checkin
 *
 * Public kiosk endpoint: mark an existing appointment as WAITING (in-clinic
 * queue) and assign it a queueOrder. Returns ticket payload for printing.
 *
 * Body: { appointmentId: string }
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { tashkentDayBounds } from "@/lib/booking-validation";
import { ok, err } from "@/server/http";
import { resolvePublicClinic } from "@/server/clinic-public/resolve";
import { runWithTenant } from "@/lib/tenant-context";
import { publishEventSafe } from "@/server/realtime/publish";
import { ticketNumberFor } from "@/server/services/ticket-number";
import {
  allocateQueueOrder,
  runQueueTx,
} from "@/server/appointments/queue-order";

const Body = z.object({ appointmentId: z.string().min(1) });

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const resolved = await resolvePublicClinic(request);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

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
        doctorId: true,
        date: true,
        time: true,
        queueStatus: true,
        queueOrder: true,
        ticketCode: true,
        patient: { select: { id: true, fullName: true } },
        doctor: {
          select: {
            id: true,
            nameRu: true,
            nameUz: true,
            color: true,
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

    // Allocate queueOrder + flip to WAITING atomically under Serializable
    // isolation so two kiosks (or kiosk + reception) can't hand out the same
    // number. allocateQueueOrder is a no-op read when the row already owns a
    // slot (already WAITING/IN_PROGRESS), so we only re-allocate from BOOKED
    // or when the order is missing.
    const needsOrder = !appt.queueOrder || appt.queueStatus === "BOOKED";
    const { queueOrder, ticketSeq, updated } = await runQueueTx(async (tx) => {
      const order = needsOrder
        ? await allocateQueueOrder(tx, {
            clinicId: ctx.clinicId,
            doctorId: appt.doctorId,
          })
        : appt.queueOrder!;
      const u = await tx.appointment.update({
        where: { id: appt.id },
        data: {
          queueStatus:
            appt.queueStatus === "BOOKED" ? "WAITING" : appt.queueStatus,
          queueOrder: order,
          // Freeze the ticket number the first time this slot enters the queue.
          // On a re-check-in (needsOrder false) we leave ticketSeq untouched so
          // a reception reorder of queueOrder never reissues the printed ticket.
          ...(needsOrder ? { ticketSeq: order } : {}),
          status: appt.queueStatus === "BOOKED" ? "WAITING" : undefined,
        },
        select: { queueStatus: true, queueOrder: true, ticketSeq: true },
      });
      return { queueOrder: order, ticketSeq: u.ticketSeq, updated: u };
    });

    publishEventSafe(ctx.clinicId, {
      type: "queue.updated",
      payload: {
        appointmentId: appt.id,
        doctorId: appt.doctorId,
        queueStatus: updated.queueStatus,
        previousStatus: appt.queueStatus,
      },
    });

    const cabinetNumber = appt.doctor.cabinet?.number ?? null;

    return ok({
      appointmentId: appt.id,
      ticketCode: appt.ticketCode,
      ticketNumber: ticketNumberFor(appt.doctorId, ticketSeq ?? queueOrder),
      queueOrder,
      patient: appt.patient,
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
