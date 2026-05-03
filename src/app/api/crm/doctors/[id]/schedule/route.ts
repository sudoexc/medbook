/**
 * /api/crm/doctors/[id]/schedule — list + replace weekly schedule.
 * See docs/TZ.md §6.6. Body for PUT: { entries: [{weekday, startTime, endTime}] }.
 *
 * Cabinet binding (Phase 11): the cabinet is no longer per-shift; it is bound
 * to the doctor (Doctor.cabinetId). Older clients that still send `cabinetId`
 * on schedule entries had it stripped by the schema upstream.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound, forbidden } from "@/server/http";
import { ReplaceScheduleSchema } from "@/server/schemas/doctor";

function doctorIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../doctors/[id]/schedule
  return parts[parts.length - 2] ?? "";
}

type ScheduleEntry = {
  weekday: number;
  startTime: string;
  endTime: string;
  validFrom?: Date | null;
  validTo?: Date | null;
  isActive?: boolean;
};

/**
 * Detects an overlapping pair within the proposed schedule. Two entries
 * overlap when they share a weekday, their time intervals intersect, and
 * their validity windows intersect (a null bound is treated as ±infinity).
 * Returns null when the schedule is clean.
 */
function findScheduleOverlap(
  entries: ScheduleEntry[],
): { aIndex: number; bIndex: number; weekday: number } | null {
  const NEG_INF = -8.64e15;
  const POS_INF = 8.64e15;
  const norm = entries.map((e, i) => ({
    i,
    weekday: e.weekday,
    start: e.startTime,
    end: e.endTime,
    from: e.validFrom ? e.validFrom.getTime() : NEG_INF,
    to: e.validTo ? e.validTo.getTime() : POS_INF,
    active: e.isActive !== false,
  }));
  for (let i = 0; i < norm.length; i++) {
    const a = norm[i];
    if (!a.active) continue;
    if (a.start >= a.end) {
      return { aIndex: a.i, bIndex: a.i, weekday: a.weekday };
    }
    for (let j = i + 1; j < norm.length; j++) {
      const b = norm[j];
      if (!b.active) continue;
      if (a.weekday !== b.weekday) continue;
      const timeOverlap = a.start < b.end && b.start < a.end;
      const validityOverlap = a.from < b.to && b.from < a.to;
      if (timeOverlap && validityOverlap) {
        return { aIndex: a.i, bIndex: b.i, weekday: a.weekday };
      }
    }
  }
  return null;
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

    const overlap = findScheduleOverlap(body.entries);
    if (overlap) {
      return err("ScheduleOverlap", 422, {
        reason: overlap.aIndex === overlap.bIndex
          ? "invalid_time_range"
          : "schedule_overlap",
        weekday: overlap.weekday,
        a: overlap.aIndex,
        b: overlap.bIndex,
      });
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
