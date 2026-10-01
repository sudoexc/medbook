/**
 * GET /api/miniapp/slots?clinicSlug=…&doctorId=…&date=YYYY-MM-DD&serviceIds=…
 *
 * Return available "HH:mm" slot strings for the given doctor on the given
 * date. Duration is the sum of the doctor's service durations (default 30m).
 *
 * The slot math reuses `findAvailableSlots` from the CRM booking service so
 * the Mini App and the receptionist dialog see the same availability grid.
 */
import { prisma } from "@/lib/prisma";
import { err, ok } from "@/server/http";
import { createMiniAppListHandler } from "@/server/miniapp/handler";
import {
  DEFAULT_SLOT_STEP_MIN,
  findAvailableSlots,
} from "@/server/services/appointments";
import { doctorServicesDuration } from "@/server/doctors/service-terms";

export const GET = createMiniAppListHandler({}, async ({ request, ctx }) => {
  const url = new URL(request.url);
  const doctorId = url.searchParams.get("doctorId");
  const dateStr = url.searchParams.get("date");
  const serviceIds = url.searchParams.getAll("serviceIds");
  if (!doctorId || !dateStr) {
    return err("missing_params", 400);
  }
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return err("bad_date", 400);
  }

  // Confirm the doctor belongs to this clinic (cross-tenant safety).
  const doctor = await prisma.doctor.findFirst({
    where: { id: doctorId, clinicId: ctx.clinicId, isActive: true },
    select: { id: true },
  });
  if (!doctor) return err("doctor_not_found", 404);

  // The doctor's own duration per service (audit DR-02): the same block the
  // booking kernel will reserve, so an offered slot is one he can take.
  let blockMin: number | undefined;
  if (serviceIds.length > 0) {
    const total = await doctorServicesDuration(prisma, {
      doctorId,
      serviceIds,
      where: { clinicId: ctx.clinicId },
    });
    if (total > 0) blockMin = total;
  }
  const slots = await findAvailableSlots({ doctorId, date, slotMin: blockMin });
  return ok({
    doctorId,
    date: date.toISOString(),
    slotMin: blockMin ?? DEFAULT_SLOT_STEP_MIN,
    slots,
  });
});
