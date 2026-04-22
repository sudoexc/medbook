// @ts-nocheck
// TODO(phase-1): rewrite — legacy Prisma schema mismatch, owned by api-builder/prisma-owner.
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const CreateSchema = z.object({
  appointmentId: z.string(),
  complaints: z.string().max(5000).optional(),
  diagnosis: z.string().max(5000).optional(),
  prescriptions: z.string().max(5000).optional(),
  recommendations: z.string().max(5000).optional(),
});

// GET /api/medical-records?patientId=&appointmentId=
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const patientId = url.searchParams.get("patientId");
  const appointmentId = url.searchParams.get("appointmentId");
  const isDoctor = session.user.role === "DOCTOR";
  const ownDoctorId = session.user.doctorId || undefined;

  if (appointmentId) {
    const record = await prisma.medicalRecord.findUnique({
      where: { appointmentId },
      include: { appointment: { include: { doctor: true, patient: true } } },
    });
    if (record && isDoctor && record.appointment.doctorId !== ownDoctorId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    return Response.json(record);
  }

  if (patientId) {
    const records = await prisma.medicalRecord.findMany({
      where: {
        appointment: {
          patientId,
          ...(isDoctor && ownDoctorId ? { doctorId: ownDoctorId } : {}),
        },
      },
      include: { appointment: { include: { doctor: true } } },
      orderBy: { createdAt: "desc" },
    });
    return Response.json(records);
  }

  return Response.json({ error: "patientId or appointmentId required" }, { status: 400 });
}

// POST /api/medical-records — create or update medical record
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

  const { appointmentId, ...data } = parsed.data;

  // Ownership check: doctors may only write records for their own appointments.
  // Admins may write for any.
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { doctorId: true },
  });
  if (!appointment) {
    return Response.json({ error: "Appointment not found" }, { status: 404 });
  }
  if (
    session.user.role === "DOCTOR" &&
    session.user.doctorId !== appointment.doctorId
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const record = await prisma.medicalRecord.upsert({
      where: { appointmentId },
      create: { appointmentId, ...data },
      update: data,
    });
    return Response.json(record);
  } catch (err) {
    console.error("[medical-records] upsert failed", err);
    return Response.json({ error: "Failed to save record" }, { status: 500 });
  }
}
