import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateBookingSlot, toTashkentDate } from "@/lib/booking-validation";
import { z } from "zod";

const RECEPTIONIST_PIN = process.env.RECEPTIONIST_PIN || "8868";

const BookSchema = z.object({
  doctorId: z.string().min(1),
  service: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "time must be HH:mm"),
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

  const { doctorId, service, date, time } = parsed.data;
  const appointmentDate = toTashkentDate(date, time);

  // Existing appointment (if re-booking) should be excluded from double-booking check
  const existingForLead = await prisma.appointment.findUnique({ where: { leadId: id }, select: { id: true } });

  const validation = await validateBookingSlot({
    doctorId,
    date: appointmentDate,
    excludeAppointmentId: existingForLead?.id,
  });
  if (!validation.ok) {
    return Response.json(
      { error: validation.message, code: validation.code, messageUz: validation.messageUz },
      { status: 400 }
    );
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
