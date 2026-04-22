/**
 * /api/crm/doctors/[id]/schedule — list + replace weekly schedule.
 * See docs/TZ.md §6.6. Body for PUT: { entries: [{weekday, startTime, endTime, cabinetId?}] }.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, forbidden } from "@/server/http";
import { ReplaceScheduleSchema } from "@/server/schemas/doctor";

function doctorIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../doctors/[id]/schedule
  return parts[parts.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const doctorId = doctorIdFromUrl(request);
    const entries = await prisma.doctorSchedule.findMany({
      where: { doctorId },
      orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
    });
    return ok({ entries });
  }
);

export const PUT = createApiHandler(
  {
    roles: ["ADMIN", "DOCTOR"],
    bodySchema: ReplaceScheduleSchema,
  },
  async ({ request, body, ctx }) => {
    const doctorId = doctorIdFromUrl(request);
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) return notFound();
    if (
      ctx.kind === "TENANT" &&
      ctx.role === "DOCTOR" &&
      doctor.userId !== ctx.userId
    ) {
      return forbidden();
    }

    // Replace atomically
    await prisma.$transaction([
      prisma.doctorSchedule.deleteMany({ where: { doctorId } }),
      prisma.doctorSchedule.createMany({
        data: body.entries.map((e) => ({
          doctorId,
          weekday: e.weekday,
          startTime: e.startTime,
          endTime: e.endTime,
          cabinetId: e.cabinetId ?? null,
          validFrom: e.validFrom ?? null,
          validTo: e.validTo ?? null,
          isActive: e.isActive ?? true,
        })) as never,
      }),
    ]);

    const entries = await prisma.doctorSchedule.findMany({
      where: { doctorId },
      orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
    });
    await audit(request, {
      action: "doctor.schedule.replace",
      entityType: "Doctor",
      entityId: doctorId,
      meta: { count: entries.length },
    });
    return ok({ entries });
  }
);
