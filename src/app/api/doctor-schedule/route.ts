// @ts-nocheck
// TODO(phase-1): rewrite — legacy Prisma schema mismatch, owned by api-builder/prisma-owner.
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// GET /api/doctor-schedule?doctorId=
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const doctorId = url.searchParams.get("doctorId") || session.user.doctorId;

  if (!doctorId) {
    return Response.json({ error: "doctorId required" }, { status: 400 });
  }

  const schedules = await prisma.doctorSchedule.findMany({
    where: { doctorId },
    orderBy: { dayOfWeek: "asc" },
  });

  const daysOff = await prisma.doctorDayOff.findMany({
    where: { doctorId, date: { gte: new Date() } },
    orderBy: { date: "asc" },
  });

  return Response.json({ schedules, daysOff });
}

const UpdateSchema = z.object({
  doctorId: z.string(),
  schedules: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    isActive: z.boolean(),
  })),
});

// POST /api/doctor-schedule — save all weekly schedules for a doctor
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { doctorId, schedules } = parsed.data;

  // Only admin or the doctor themselves can update
  if (session.user.role !== "ADMIN" && session.user.doctorId !== doctorId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Upsert each day
  const results = await Promise.all(
    schedules.map((s) =>
      prisma.doctorSchedule.upsert({
        where: { doctorId_dayOfWeek: { doctorId, dayOfWeek: s.dayOfWeek } },
        create: { doctorId, ...s },
        update: s,
      })
    )
  );

  return Response.json(results);
}
