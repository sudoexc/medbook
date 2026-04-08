import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const UpdateSchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "CONVERTED", "CANCELLED"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = UpdateSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: "Invalid status" }, { status: 400 });
  }

  const lead = await prisma.lead.update({
    where: { id },
    data: { status: parsed.data.status },
  });

  // Auto-create patient + appointment when lead is converted
  if (parsed.data.status === "CONVERTED" && lead.doctorId) {
    const existing = await prisma.appointment.findUnique({ where: { leadId: id } });
    if (!existing) {
      // Find or create patient by phone
      const patient = await prisma.patient.upsert({
        where: { phone: lead.phone },
        update: { fullName: lead.name },
        create: { fullName: lead.name, phone: lead.phone },
      });

      // Get next queue position for this doctor today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const lastInQueue = await prisma.appointment.findFirst({
        where: { doctorId: lead.doctorId, date: { gte: today, lt: tomorrow } },
        orderBy: { queueOrder: "desc" },
      });

      await prisma.appointment.create({
        data: {
          patientId: patient.id,
          doctorId: lead.doctorId,
          service: lead.service,
          date: lead.date ? new Date(lead.date) : new Date(),
          source: "ONLINE",
          queueOrder: (lastInQueue?.queueOrder ?? 0) + 1,
          leadId: id,
        },
      });
    }
  }

  return Response.json(lead);
}
