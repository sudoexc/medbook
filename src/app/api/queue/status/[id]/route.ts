import { prisma } from "@/lib/prisma";

// GET /api/queue/status/:id — public endpoint for patient queue status (QR code page)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: { patient: true, doctor: true },
  });

  if (!appointment) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Get today's queue for this doctor to calculate position
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const waiting = await prisma.appointment.findMany({
    where: {
      doctorId: appointment.doctorId,
      date: { gte: today, lt: tomorrow },
      queueStatus: "WAITING",
    },
    orderBy: { queueOrder: "asc" },
  });

  // Calculate average duration for ETA
  const completedToday = await prisma.appointment.findMany({
    where: {
      doctorId: appointment.doctorId,
      date: { gte: today, lt: tomorrow },
      queueStatus: "COMPLETED",
      durationMin: { not: null },
    },
    select: { durationMin: true },
  });

  const avgDuration = completedToday.length > 0
    ? Math.round(completedToday.reduce((s, c) => s + c.durationMin!, 0) / completedToday.length)
    : 20;

  const position = appointment.queueStatus === "WAITING"
    ? waiting.findIndex((w) => w.id === id) + 1
    : appointment.queueStatus === "IN_PROGRESS" ? 0 : -1;

  const hasCurrentPatient = await prisma.appointment.count({
    where: {
      doctorId: appointment.doctorId,
      date: { gte: today, lt: tomorrow },
      queueStatus: "IN_PROGRESS",
    },
  });

  const etaMinutes = position > 0
    ? (hasCurrentPatient ? avgDuration : 0) + (position - 1) * avgDuration
    : 0;

  const ticketNumber = `${appointment.doctor.id.charAt(0).toUpperCase()}${String(appointment.queueOrder || 0).padStart(3, "0")}`;

  return Response.json({
    patientName: appointment.patient.fullName,
    doctorName: appointment.doctor.nameRu,
    cabinet: appointment.doctor.cabinet,
    service: appointment.service,
    status: appointment.queueStatus,
    position: position > 0 ? position : 0,
    totalWaiting: waiting.length,
    etaMinutes,
    ticketNumber,
  });
}
