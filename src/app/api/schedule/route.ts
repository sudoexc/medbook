import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// GET /api/schedule?date=2026-04-07&doctorId=optional
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dateStr = url.searchParams.get("date") || new Date().toISOString().split("T")[0];
  const filterDoctorId = url.searchParams.get("doctorId");

  const dayStart = new Date(dateStr + "T00:00:00");
  const dayEnd = new Date(dateStr + "T23:59:59");

  const doctorFilter =
    session.user.role === "ADMIN"
      ? filterDoctorId ? { doctorId: filterDoctorId } : {}
      : { doctorId: session.user.doctorId || undefined };

  const appointments = await prisma.appointment.findMany({
    where: {
      ...doctorFilter,
      date: { gte: dayStart, lte: dayEnd },
      queueStatus: { not: "CANCELLED" },
    },
    include: { patient: true, doctor: true },
    orderBy: { date: "asc" },
  });

  return Response.json(appointments);
}

const CreateSchema = z.object({
  patientId: z.string(),
  doctorId: z.string(),
  service: z.string().optional(),
  date: z.string(), // ISO datetime with specific time
});

// POST /api/schedule — create appointment at specific time
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { patientId, doctorId, service, date } = parsed.data;

  const appointment = await prisma.appointment.create({
    data: {
      patientId,
      doctorId,
      service,
      date: new Date(date),
      source: "WALKIN",
      queueStatus: "WAITING",
    },
    include: { patient: true, doctor: true },
  });

  return Response.json(appointment, { status: 201 });
}
