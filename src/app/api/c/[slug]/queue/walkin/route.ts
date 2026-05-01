/**
 * POST /api/c/[slug]/queue/walkin
 *
 * Public kiosk endpoint: register a walk-in patient (no prior appointment),
 * place them at the back of the chosen doctor's live queue, and return the
 * ticket payload for printing.
 *
 * Body: { fullName, phone, doctorId, lang? }
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { normalizePhone, phoneSearchVariants } from "@/lib/phone";
import { ok, err } from "@/server/http";
import { resolvePublicClinic } from "@/server/clinic-public/resolve";
import { runWithTenant } from "@/lib/tenant-context";
import { publishEventSafe } from "@/server/realtime/publish";
import { ticketNumberFor } from "@/server/services/ticket-number";

const Body = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(3).max(20),
  doctorId: z.string().min(1),
  lang: z.enum(["RU", "UZ"]).optional(),
});

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
    const phoneNorm = normalizePhone(parsed.phone);
    if (!phoneNorm) return err("bad_phone", 400);

    const doctor = await prisma.doctor.findFirst({
      where: { id: parsed.doctorId, clinicId: ctx.clinicId, isActive: true },
      select: {
        id: true,
        nameRu: true,
        nameUz: true,
        color: true,
        pricePerVisit: true,
        cabinetId: true,
        cabinet: { select: { number: true } },
      },
    });
    if (!doctor) return err("doctor_not_found", 404);

    // Find or create patient.
    const variants = phoneSearchVariants(parsed.phone);
    let patient = await prisma.patient.findFirst({
      where: { clinicId: ctx.clinicId, phone: { in: variants } },
      select: { id: true, fullName: true },
    });
    if (!patient) {
      patient = await prisma.patient.create({
        data: {
          clinicId: ctx.clinicId,
          fullName: parsed.fullName,
          phone: phoneNorm,
          phoneNormalized: phoneNorm,
          preferredLang: parsed.lang ?? "RU",
          source: "WALKIN",
        } as never,
        select: { id: true, fullName: true },
      });
    }

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const max = await prisma.appointment.aggregate({
      where: {
        clinicId: ctx.clinicId,
        doctorId: doctor.id,
        date: { gte: dayStart, lt: dayEnd },
        queueStatus: { in: ["WAITING", "IN_PROGRESS", "COMPLETED"] },
      },
      _max: { queueOrder: true },
    });
    const queueOrder = (max._max.queueOrder ?? 0) + 1;

    // Place the appointment "now" so it appears at the top of today's lists.
    // The receptionist/CRM can re-time it later if needed.
    const start = new Date();
    const durationMin = 30;
    const end = new Date(start.getTime() + durationMin * 60_000);
    const time = `${String(start.getHours()).padStart(2, "0")}:${String(
      start.getMinutes(),
    ).padStart(2, "0")}`;

    const created = await prisma.appointment.create({
      data: {
        clinicId: ctx.clinicId,
        patientId: patient.id,
        doctorId: doctor.id,
        cabinetId: doctor.cabinetId,
        date: start,
        time,
        durationMin,
        endDate: end,
        status: "WAITING",
        queueStatus: "WAITING",
        queueOrder,
        channel: "WALKIN",
        priceBase: doctor.pricePerVisit ?? null,
        priceFinal: doctor.pricePerVisit ?? null,
      } as never,
      select: { id: true },
    });

    publishEventSafe(ctx.clinicId, {
      type: "appointment.created",
      payload: {
        appointmentId: created.id,
        doctorId: doctor.id,
        patientId: patient.id,
        status: "WAITING",
      },
    });
    publishEventSafe(ctx.clinicId, {
      type: "queue.updated",
      payload: {
        appointmentId: created.id,
        doctorId: doctor.id,
        queueStatus: "WAITING",
      },
    });

    const cabinetNumber = doctor.cabinet?.number ?? null;

    return ok(
      {
        appointmentId: created.id,
        ticketNumber: ticketNumberFor(doctor.id, queueOrder),
        queueOrder,
        patient: { id: patient.id, fullName: patient.fullName },
        doctor: {
          id: doctor.id,
          nameRu: doctor.nameRu,
          nameUz: doctor.nameUz,
          color: doctor.color,
        },
        cabinet: cabinetNumber,
      },
      201,
    );
  });
}
