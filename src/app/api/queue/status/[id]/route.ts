// @ts-nocheck
// TODO(phase-1): rewrite — legacy Prisma schema mismatch, owned by api-builder/prisma-owner.
import { prisma } from "@/lib/prisma";
import { tashkentDayBounds } from "@/lib/booking-validation";
import { initials } from "@/lib/format";
import { predictETA } from "@/lib/ai/eta-predictor";

// GET /api/queue/status/:id — public endpoint for patient queue status (QR code page)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const appointment = await prisma.appointment.findUnique({
    where: { id },
    select: {
      id: true,
      doctorId: true,
      serviceId: true,
      service: true,
      durationMin: true,
      queueStatus: true,
      queueOrder: true,
      patient: { select: { fullName: true } },
      doctor: { select: { id: true, nameRu: true, cabinet: true } },
      primaryService: { select: { durationMin: true } },
    },
  });

  if (!appointment) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { dayStart: today, dayEnd: tomorrow } = tashkentDayBounds();
  const fallbackMin =
    appointment.primaryService?.durationMin ?? appointment.durationMin ?? 30;

  const [totalWaiting, ahead, history, hasCurrentPatient] = await Promise.all([
    prisma.appointment.count({
      where: {
        doctorId: appointment.doctorId,
        date: { gte: today, lt: tomorrow },
        queueStatus: "WAITING",
      },
    }),
    appointment.queueStatus === "WAITING" && appointment.queueOrder != null
      ? prisma.appointment.count({
          where: {
            doctorId: appointment.doctorId,
            date: { gte: today, lt: tomorrow },
            queueStatus: "WAITING",
            queueOrder: { lt: appointment.queueOrder },
          },
        })
      : Promise.resolve(0),
    appointment.serviceId
      ? prisma.appointment.findMany({
          where: {
            doctorId: appointment.doctorId,
            serviceId: appointment.serviceId,
            status: "COMPLETED",
            startedAt: { not: null },
            completedAt: { not: null },
          },
          select: { startedAt: true, completedAt: true },
          orderBy: { completedAt: "desc" },
          take: 30,
        })
      : Promise.resolve([] as Array<{ startedAt: Date; completedAt: Date }>),
    prisma.appointment.count({
      where: {
        doctorId: appointment.doctorId,
        date: { gte: today, lt: tomorrow },
        queueStatus: "IN_PROGRESS",
      },
    }),
  ]);

  const samples = (history as Array<{ startedAt: Date | null; completedAt: Date | null }>)
    .filter(
      (c): c is { startedAt: Date; completedAt: Date } =>
        c.startedAt !== null && c.completedAt !== null,
    )
    .map((c) => ({ startedAt: c.startedAt, completedAt: c.completedAt }));
  const prediction = predictETA({ history: samples, fallbackMin });
  const perVisitMin = prediction.etaMin;

  const position = appointment.queueStatus === "WAITING"
    ? ahead + 1
    : appointment.queueStatus === "IN_PROGRESS" ? 0 : -1;

  const etaMinutes = position > 0
    ? (hasCurrentPatient ? perVisitMin : 0) + (position - 1) * perVisitMin
    : 0;

  const ticketNumber = `${appointment.doctor.id.charAt(0).toUpperCase()}${String(appointment.queueOrder || 0).padStart(3, "0")}`;

  // Public endpoint (patients reach it via QR link). Strip PII — initials only,
  // no phone / passport / notes / email. Doctor name and cabinet are public
  // clinic info, safe to return.
  return Response.json({
    patientName: initials(appointment.patient.fullName),
    doctorName: appointment.doctor.nameRu,
    cabinet: appointment.doctor.cabinet,
    service: appointment.service,
    status: appointment.queueStatus,
    position: position > 0 ? position : 0,
    totalWaiting,
    etaMinutes,
    etaConfidence: prediction.confidence,
    etaSource: prediction.source,
    ticketNumber,
  });
}
