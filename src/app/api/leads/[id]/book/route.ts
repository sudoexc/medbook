// @ts-nocheck
// TODO(phase-1): rewrite — legacy Prisma schema mismatch, owned by api-builder/prisma-owner.
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateBookingSlot, toTashkentDate } from "@/lib/booking-validation";
import { hasValidPin } from "@/lib/pin";
import { normalizePhone } from "@/lib/phone";
import { z } from "zod";

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
  // Allow: receptionist terminal (PIN) OR any authenticated dashboard user.
  // Page-level UI (`canBook`) already gates ADMIN/RECEPTIONIST visibility;
  // DOCTORs can convert their own leads via direct API if needed.
  if (!hasValidPin(request)) {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
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

  // Find or create patient by normalized phone (defensive: legacy leads
  // predating the normalization fix may still contain formatted strings).
  const patientPhone = normalizePhone(lead.phone) || lead.phone;
  const patient = await prisma.patient.upsert({
    where: { phone: patientPhone },
    update: { fullName: lead.name },
    create: { fullName: lead.name, phone: patientPhone },
  });

  // Reuse the existing-appointment lookup from above
  let appointment;
  if (existingForLead) {
    appointment = await prisma.appointment.update({
      where: { leadId: id },
      data: {
        doctorId,
        service: service || null,
        date: appointmentDate,
      },
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
        doctor: { select: { id: true, nameRu: true, cabinet: true } },
      },
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
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
        doctor: { select: { id: true, nameRu: true, cabinet: true } },
      },
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
