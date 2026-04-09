import { auth } from "@/lib/auth";
import { isAuthorizedOrPin } from "@/lib/auth-or-pin";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// GET /api/queue?doctorId=&date=
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const requestedDoctorId = url.searchParams.get("doctorId");
  const dateStr = url.searchParams.get("date");

  // Non-admins can only see their own queue, regardless of ?doctorId=
  const isAdmin = session.user.role === "ADMIN" || session.user.role === "RECEPTIONIST";
  const doctorId = isAdmin ? (requestedDoctorId || session.user.doctorId) : session.user.doctorId;

  if (!doctorId) {
    return Response.json({ error: "doctorId required" }, { status: 400 });
  }

  // Date range: today in Tashkent (UTC+5)
  const now = dateStr ? new Date(dateStr) : new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // Run both queries in parallel — they're independent.
  const [appointments, completed] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        doctorId,
        date: { gte: dayStart, lt: dayEnd },
        queueStatus: { in: ["WAITING", "IN_PROGRESS"] },
      },
      include: {
        patient: { select: { id: true, fullName: true, phone: true, passport: true } },
      },
      orderBy: { queueOrder: "asc" },
    }),
    prisma.appointment.findMany({
      where: {
        doctorId,
        date: { gte: dayStart, lt: dayEnd },
        queueStatus: "COMPLETED",
      },
      include: {
        patient: { select: { id: true, fullName: true, phone: true, passport: true } },
      },
      orderBy: { completedAt: "desc" },
    }),
  ]);

  return Response.json({ queue: appointments, completed });
}

const AddSchema = z.object({
  patientId: z.string(),
  doctorId: z.string(),
  service: z.string().optional(),
});

// POST /api/queue — add patient to today's queue
export async function POST(request: Request) {
  if (!(await isAuthorizedOrPin(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = AddSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { patientId, doctorId, service } = parsed.data;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Get next queue position
  const last = await prisma.appointment.findFirst({
    where: { doctorId, date: { gte: today, lt: tomorrow } },
    orderBy: { queueOrder: "desc" },
  });

  const appointment = await prisma.appointment.create({
    data: {
      patientId,
      doctorId,
      service,
      date: new Date(),
      source: "WALKIN",
      queueOrder: (last?.queueOrder ?? 0) + 1,
      queueStatus: "WAITING",
    },
    include: {
      patient: { select: { id: true, fullName: true, phone: true, passport: true } },
    },
  });

  return Response.json(appointment, { status: 201 });
}
