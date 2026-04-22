import { isAuthorizedOrPin } from "@/lib/auth-or-pin";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { audit } from "@/lib/audit";
import { z } from "zod";

const UpdateSchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "CONVERTED", "CANCELLED"]),
  skipAppointment: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthorizedOrPin(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = UpdateSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: "Invalid status" }, { status: 400 });
  }

  const before = await prisma.lead.findUnique({ where: { id }, select: { status: true } });
  const lead = await prisma.lead.update({
    where: { id },
    data: { status: parsed.data.status },
  });
  await audit(request, {
    action: "lead.status.update",
    entityType: "Lead",
    entityId: id,
    meta: { from: before?.status ?? null, to: parsed.data.status },
  });

  // Auto-create patient + appointment when lead is converted (unless explicitly skipped)
  if (parsed.data.status === "CONVERTED" && !parsed.data.skipAppointment && lead.doctorId) {
    const existing = await prisma.appointment.findUnique({ where: { leadId: id } });
    if (!existing) {
      // Find or create patient by normalized phone
      const patientPhone = normalizePhone(lead.phone) || lead.phone;
      const patient = await prisma.patient.upsert({
        where: { phone: patientPhone },
        update: { fullName: lead.name },
        create: { fullName: lead.name, phone: patientPhone },
      });

      // queueOrder is intentionally left null — it gets assigned on arrival
      // at the kiosk (see /api/kiosk/checkin POST). Walk-ins reserve the
      // order at creation time; online bookings claim it only after check-in.
      await prisma.appointment.create({
        data: {
          patientId: patient.id,
          doctorId: lead.doctorId,
          service: lead.service,
          date: lead.date ? new Date(lead.date) : new Date(),
          source: "ONLINE",
          queueStatus: "WAITING",
          leadId: id,
        },
      });
    }
  }

  return Response.json(lead);
}
