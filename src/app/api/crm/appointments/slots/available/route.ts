/**
 * /api/crm/appointments/slots/available — return "HH:mm" slots for a doctor/date.
 * See docs/TZ.md §7.8.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, parseQuery } from "@/server/http";
import { SlotsQuerySchema } from "@/server/schemas/appointment";
import { findAvailableSlots } from "@/server/services/appointments";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const parsed = parseQuery(request, SlotsQuerySchema);
    if (!parsed.ok) return parsed.response;
    const { doctorId, date, serviceIds } = parsed.value;

    // Derive total duration from serviceIds sum (or 30 min default).
    let slotMin = 30;
    if (serviceIds.length > 0) {
      const svcs = await prisma.service.findMany({
        where: { id: { in: serviceIds } },
        select: { durationMin: true },
      });
      const total = svcs.reduce((acc, s) => acc + s.durationMin, 0);
      if (total > 0) slotMin = total;
    }

    const slots = await findAvailableSlots({ doctorId, date, slotMin });
    return ok({ doctorId, date, slotMin, slots });
  }
);
