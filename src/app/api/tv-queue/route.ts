import { prisma } from "@/lib/prisma";

// GET /api/tv-queue — public, no auth needed. Returns queue data for TV display.
export async function GET() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // All three queries are independent — run in parallel.
  const [doctors, appointments, completedToday] = await Promise.all([
    prisma.doctor.findMany({
      where: { active: true },
      select: { id: true, nameRu: true, cabinet: true },
      orderBy: { cabinet: "asc" },
    }),
    prisma.appointment.findMany({
      where: {
        date: { gte: today, lt: tomorrow },
        queueStatus: { in: ["WAITING", "IN_PROGRESS"] },
        // Hide online bookings that haven't checked in at the kiosk yet.
        queueOrder: { not: null },
      },
      select: {
        id: true,
        doctorId: true,
        queueStatus: true,
        queueOrder: true,
        startedAt: true,
        patient: { select: { fullName: true } },
      },
      orderBy: { queueOrder: "asc" },
    }),
    prisma.appointment.findMany({
      where: {
        date: { gte: today, lt: tomorrow },
        queueStatus: "COMPLETED",
        durationMin: { not: null },
      },
      select: { doctorId: true, durationMin: true },
    }),
  ]);

  // Calculate average duration per doctor
  const avgByDoctor: Record<string, number> = {};
  for (const doc of doctors) {
    const durations = completedToday
      .filter((c) => c.doctorId === doc.id && c.durationMin)
      .map((c) => c.durationMin!);
    avgByDoctor[doc.id] = durations.length > 0
      ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
      : 20; // default 20 min
  }

  const result = doctors.map((doc) => {
    const docAppts = appointments.filter((a) => a.doctorId === doc.id);
    const current = docAppts.find((a) => a.queueStatus === "IN_PROGRESS");
    const waiting = docAppts.filter((a) => a.queueStatus === "WAITING");

    return {
      id: doc.id,
      nameRu: doc.nameRu,
      cabinet: doc.cabinet,
      avgDuration: avgByDoctor[doc.id],
      current: current
        ? { fullName: current.patient.fullName, startedAt: current.startedAt?.toISOString() || null }
        : null,
      waiting: waiting.map((w, i) => ({
        id: w.id,
        fullName: w.patient.fullName,
        queueOrder: w.queueOrder || 0,
        ticketNumber: `${doc.id.charAt(0).toUpperCase()}-${String(w.queueOrder || 0).padStart(3, "0")}`,
        etaMinutes: (current ? 1 : 0) * avgByDoctor[doc.id] + i * avgByDoctor[doc.id],
      })),
      calling: null as { fullName: string; cabinet: number } | null,
    };
  });

  return Response.json(result);
}

// POST /api/tv-queue — call a patient (triggers TV announcement)
export async function POST(request: Request) {
  const body = await request.json();
  const { appointmentId } = body;

  if (!appointmentId) {
    return Response.json({ error: "appointmentId required" }, { status: 400 });
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      patient: { select: { fullName: true } },
      doctor: { select: { nameRu: true, cabinet: true } },
    },
  });

  if (!appointment) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Store the call event in a global variable (in production would use Redis/DB)
  // For now we use a simple approach: store in DB as a temporary field
  // We'll use the appointment's notes field with a special prefix
  const callData = {
    fullName: appointment.patient.fullName,
    cabinet: appointment.doctor.cabinet,
    doctorName: appointment.doctor.nameRu,
    calledAt: new Date().toISOString(),
  };

  // We'll serve this via a separate endpoint
  return Response.json(callData);
}
