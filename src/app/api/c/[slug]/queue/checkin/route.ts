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
import { ok, err } from "@/server/http";
import { resolvePublicClinic } from "@/server/clinic-public/resolve";
import { runWithTenant } from "@/lib/tenant-context";
import { publishEventSafe } from "@/server/realtime/publish";
import { ticketNumberFor } from "@/server/services/ticket-number";

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

    // Only allow checkin for today's appointments.
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
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

    // Assign queueOrder if not already in WAITING/IN_PROGRESS.
    let queueOrder = appt.queueOrder;
    if (!queueOrder || appt.queueStatus === "BOOKED") {
      const max = await prisma.appointment.aggregate({
        where: {
          clinicId: ctx.clinicId,
          doctorId: appt.doctorId,
          date: { gte: dayStart, lt: dayEnd },
          queueStatus: { in: ["WAITING", "IN_PROGRESS", "COMPLETED"] },
        },
        _max: { queueOrder: true },
      });
      queueOrder = (max._max.queueOrder ?? 0) + 1;
    }

    const updated = await prisma.appointment.update({
      where: { id: appt.id },
      data: {
        queueStatus: appt.queueStatus === "BOOKED" ? "WAITING" : appt.queueStatus,
        queueOrder,
        status: appt.queueStatus === "BOOKED" ? "WAITING" : undefined,
      },
      select: { queueStatus: true, queueOrder: true },
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
      ticketNumber: ticketNumberFor(appt.doctorId, queueOrder),
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
