import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const CreateSchema = z.object({
  doctorId: z.string(),
  date: z.string(), // YYYY-MM-DD
  reason: z.string().max(500).optional(),
});

// POST /api/doctor-schedule/days-off — add a day off
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

  const { doctorId, date, reason } = parsed.data;

  if (session.user.role !== "ADMIN" && session.user.doctorId !== doctorId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const dayOff = await prisma.doctorDayOff.upsert({
    where: { doctorId_date: { doctorId, date: new Date(date + "T00:00:00") } },
    create: { doctorId, date: new Date(date + "T00:00:00"), reason },
    update: { reason },
  });

  return Response.json(dayOff);
}

const DeleteSchema = z.object({ id: z.string() });

// DELETE /api/doctor-schedule/days-off — remove a day off
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "id required" }, { status: 400 });
  }

  await prisma.doctorDayOff.delete({ where: { id: parsed.data.id } });
  return Response.json({ ok: true });
}
