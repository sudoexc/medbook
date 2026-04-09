import { auth } from "@/lib/auth";
import { isAuthorizedOrPin } from "@/lib/auth-or-pin";
import { prisma } from "@/lib/prisma";
import { tashkentDayBounds } from "@/lib/booking-validation";
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

  // Date range: that calendar day in Tashkent (UTC+5).
  // setHours(0,0,0,0) on Vercel uses UTC midnight, which skews ±5h.
  const at = dateStr ? new Date(dateStr) : new Date();
  const { dayStart, dayEnd } = tashkentDayBounds(at);

  // Run both queries in parallel — they're independent.
  const [appointments, completed] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        doctorId,
        date: { gte: dayStart, lt: dayEnd },
        queueStatus: { in: ["WAITING", "IN_PROGRESS"] },
        // Hide online bookings that haven't checked in at the kiosk yet.
        queueOrder: { not: null },
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

  const { dayStart, dayEnd } = tashkentDayBounds();

  // Get next queue position (ignore not-yet-checked-in online bookings)
  const last = await prisma.appointment.findFirst({
    where: {
      doctorId,
      date: { gte: dayStart, lt: dayEnd },
      queueOrder: { not: null },
    },
    orderBy: { queueOrder: "desc" },
    select: { queueOrder: true },
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
