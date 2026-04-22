import { prisma } from "@/lib/prisma";
import { tashkentDayBounds } from "@/lib/booking-validation";
import { initials } from "@/lib/format";

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
      service: true,
      queueStatus: true,
      queueOrder: true,
      patient: { select: { fullName: true } },
      doctor: { select: { id: true, nameRu: true, cabinet: true } },
    },
  });

  if (!appointment) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Get today's queue for this doctor to calculate position & total
  const { dayStart: today, dayEnd: tomorrow } = tashkentDayBounds();

  const [totalWaiting, ahead, completedDurations, hasCurrentPatient] = await Promise.all([
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
    prisma.appointment.findMany({
      where: {
        doctorId: appointment.doctorId,
        date: { gte: today, lt: tomorrow },
        queueStatus: "COMPLETED",
        durationMin: { not: null },
      },
      select: { durationMin: true },
    }),
    prisma.appointment.count({
      where: {
        doctorId: appointment.doctorId,
        date: { gte: today, lt: tomorrow },
        queueStatus: "IN_PROGRESS",
      },
    }),
  ]);

  const avgDuration = completedDurations.length > 0
    ? Math.round(completedDurations.reduce((s, c) => s + (c.durationMin ?? 0), 0) / completedDurations.length)
    : 20;

  const position = appointment.queueStatus === "WAITING"
    ? ahead + 1
    : appointment.queueStatus === "IN_PROGRESS" ? 0 : -1;

  const etaMinutes = position > 0
    ? (hasCurrentPatient ? avgDuration : 0) + (position - 1) * avgDuration
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
    ticketNumber,
  });
}
