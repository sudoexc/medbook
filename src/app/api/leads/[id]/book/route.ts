import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const RECEPTIONIST_PIN = process.env.RECEPTIONIST_PIN || "8868";

const BookSchema = z.object({
  doctorId: z.string().min(1),
  service: z.string().optional(),
  date: z.string().min(10), // ISO datetime, e.g. "2026-04-15T09:00:00"
});

// POST /api/leads/[id]/book — schedule an appointment from a lead and mark it CONVERTED
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Allow: receptionist terminal (PIN) OR admin/receptionist session
  const pin = request.headers.get("x-terminal-pin");
  const viaPin = pin === RECEPTIONIST_PIN;
  if (!viaPin) {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.user.role !== "ADMIN" && session.user.role !== "RECEPTIONIST") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = BookSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) {
    return Response.json({ error: "Lead not found" }, { status: 404 });
  }

  const { doctorId, service, date } = parsed.data;
  const appointmentDate = new Date(date);
  if (isNaN(appointmentDate.getTime())) {
    return Response.json({ error: "Invalid date" }, { status: 400 });
  }

  // Find or create patient by phone
  const patient = await prisma.patient.upsert({
    where: { phone: lead.phone },
    update: { fullName: lead.name },
    create: { fullName: lead.name, phone: lead.phone },
  });

  // Check if an appointment already exists for this lead
  const existing = await prisma.appointment.findUnique({ where: { leadId: id } });
  let appointment;
  if (existing) {
    appointment = await prisma.appointment.update({
      where: { leadId: id },
      data: {
        doctorId,
        service: service || null,
        date: appointmentDate,
      },
      include: { patient: true, doctor: true },
    });
  } else {
    appointment = await prisma.appointment.create({
      data: {
        patientId: patient.id,
        doctorId,
        service: service || null,
        date: appointmentDate,
        source: "ONLINE",
        leadId: id,
        queueStatus: "WAITING",
      },
      include: { patient: true, doctor: true },
    });
  }

  // Mark lead as converted (with doctorId if changed)
  await prisma.lead.update({
    where: { id },
    data: {
      status: "CONVERTED",
      doctorId,
      service: service || lead.service,
    },
  });

  return Response.json({ success: true, appointment });
}
