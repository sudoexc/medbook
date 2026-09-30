/**
 * GET /api/crm/doctors/today — the doctors page's «сегодня»: working time
 * from the schedule, booked minutes, load, live status, the next free slot,
 * today's revenue and the hour heatmap, per active doctor (audit DR-08;
 * definitions in src/server/doctors/today.ts).
 *
 * Same audience as `GET /api/crm/doctors/stats`; a DOCTOR only ever gets
 * his own row.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { loadDoctorsToday } from "@/server/doctors/today";
import { findAvailableSlots } from "@/server/services/appointments";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ ctx }) => {
    let doctorId: string | undefined;
    if (ctx.kind === "TENANT" && ctx.role === "DOCTOR") {
      const own = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (!own) {
        return ok({
          date: null,
          doctors: [],
          clinic: { booked: 0, bookedMinutes: 0, workingMinutes: 0, loadPct: null },
        });
      }
      doctorId = own.id;
    }

    const today = await loadDoctorsToday(prisma, {
      doctorId,
      // The booking calendar's own slot finder: the same free slots the
      // «Записать» dialog offers, never one already past.
      findNextFree: async (id, now) =>
        (await findAvailableSlots({ doctorId: id, date: now }))[0] ?? null,
    });
    return ok(today);
  },
);
