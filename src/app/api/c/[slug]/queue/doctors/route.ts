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
import { loadOnDutyDoctorIds } from "@/server/doctors/on-duty";

export const dynamic = "force-dynamic";

export const GET = createPublicClinicHandler(async ({ ctx }) => {
  const activeDoctors = await prisma.doctor.findMany({
    where: {
      clinicId: ctx.clinicId,
      isActive: true,
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
  // Q-08 — the kiosk offers only doctors who work now: the schedule valid
  // today without time off, or a live queue reception already runs for
  // him. The walk-in itself checks the same rule (`registerWalkin`).
  const onDuty = await loadOnDutyDoctorIds(prisma, {
    clinicId: ctx.clinicId,
    doctorIds: activeDoctors.map((d) => d.id),
  });
  const doctors = activeDoctors.filter((d) => onDuty.has(d.id));

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
