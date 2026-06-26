/**
 * GET /api/c/[slug]/queue/doctors
 *
 * Public list of today's working doctors for the kiosk walk-in flow.
 * For each doctor: how many people are in front of them right now and
 * how long the next free walk-in slot is approximately away.
 */
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { createPublicClinicHandler } from "@/server/clinic-public/resolve";
import { getQueueProjection } from "@/server/appointments/queue-projection";
import { tashkentComponents } from "@/lib/booking-validation";

export const dynamic = "force-dynamic";

export const GET = createPublicClinicHandler(async ({ ctx }) => {
  // Tashkent wall-clock weekday — the server runs UTC, so a naive day pick would
  // choose the wrong schedule weekday near midnight (same fix as the TV board).
  const weekday = tashkentComponents(new Date()).dow;

  const doctors = await prisma.doctor.findMany({
    where: {
      clinicId: ctx.clinicId,
      isActive: true,
      schedules: { some: { weekday, isActive: true } },
    },
    select: {
      id: true,
      nameRu: true,
      nameUz: true,
      specializationRu: true,
      specializationUz: true,
      photoUrl: true,
      color: true,
      pricePerVisit: true,
      cabinet: { select: { number: true } },
    },
    orderBy: { nameRu: "asc" },
  });

  if (doctors.length === 0) {
    return ok({ doctors: [] });
  }

  const doctorIds = doctors.map((d) => d.id);
  const projection = await getQueueProjection({
    clinicId: ctx.clinicId,
    doctorIds,
  });

  const out = doctors.map((d) => {
    const q = projection.get(d.id);
    // People ahead of a new walk-in = everyone WAITING plus the one being seen.
    const activeCount = q ? q.waiting.length + (q.current ? 1 : 0) : 0;
    const perVisitMin = q?.perVisitMin ?? 30;
    return {
      id: d.id,
      nameRu: d.nameRu,
      nameUz: d.nameUz,
      specializationRu: d.specializationRu,
      specializationUz: d.specializationUz,
      photoUrl: d.photoUrl,
      color: d.color,
      cabinet: d.cabinet?.number ?? null,
      pricePerVisit: d.pricePerVisit,
      waitingCount: activeCount,
      etaMinutes: activeCount * perVisitMin,
    };
  });

  return ok({ doctors: out });
});
