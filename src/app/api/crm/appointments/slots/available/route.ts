/**
 * /api/crm/appointments/slots/available — return "HH:mm" slots for a doctor/date.
 * See docs/TZ.md §7.8.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, parseQuery } from "@/server/http";
import { SlotsQuerySchema } from "@/server/schemas/appointment";
import {
  DEFAULT_SLOT_STEP_MIN,
  findAvailableSlots,
} from "@/server/services/appointments";
import { doctorServicesDuration } from "@/server/doctors/service-terms";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const parsed = parseQuery(request, SlotsQuerySchema);
    if (!parsed.ok) return parsed.response;
    const { doctorId, date, serviceIds } = parsed.value;

    // Mirror the mini-app twin (/api/miniapp/slots): a deactivated or
    // foreign doctor must answer with no slots, not a synthetic free day —
    // findAvailableSlots falls back to a full 09:00-19:00 window for
    // doctors without a schedule, which a deactivated doctor always is.
    // (Tenant extension scopes the lookup to the caller's clinic.)
    const doctor = await prisma.doctor.findFirst({
      where: { id: doctorId, isActive: true },
      select: { id: true },
    });
    if (!doctor) {
      return ok({
        doctorId,
        date,
        slotMin: DEFAULT_SLOT_STEP_MIN,
        slots: [],
      });
    }

    // Appointment block = sum of selected services AS THIS DOCTOR does them
    // (his duration override wins, audit DR-02), so the grid offers the same
    // block the booking will reserve; with none selected it falls back to
    // the 20-min grid step inside findAvailableSlots.
    let blockMin: number | undefined;
    if (serviceIds.length > 0) {
      const total = await doctorServicesDuration(prisma, { doctorId, serviceIds });
      if (total > 0) blockMin = total;
    }

    const slots = await findAvailableSlots({ doctorId, date, slotMin: blockMin });
    return ok({
      doctorId,
      date,
      slotMin: blockMin ?? DEFAULT_SLOT_STEP_MIN,
      slots,
    });
  }
);
