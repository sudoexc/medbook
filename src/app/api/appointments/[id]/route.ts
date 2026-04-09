import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const UpdateSchema = z.object({
  status: z.enum(["WAITING", "IN_PROGRESS", "COMPLETED", "SKIPPED", "CANCELLED"]),
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

  // Ownership check — doctors can only modify their own appointments
  if (session.user.role === "DOCTOR") {
    const existing = await prisma.appointment.findUnique({ where: { id }, select: { doctorId: true } });
    if (!existing || existing.doctorId !== session.user.doctorId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const appointment = await prisma.appointment.update({
    where: { id },
    data: { queueStatus: parsed.data.status },
  });

  return Response.json(appointment);
}
