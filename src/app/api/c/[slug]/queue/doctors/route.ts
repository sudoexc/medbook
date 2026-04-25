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

export const dynamic = "force-dynamic";

export const GET = createPublicClinicHandler(async ({ ctx }) => {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const weekday = dayStart.getDay();

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
      schedules: {
        where: { weekday, isActive: true },
        select: { cabinetId: true, startTime: true, endTime: true },
        take: 1,
      },
    },
    orderBy: { nameRu: "asc" },
  });

  if (doctors.length === 0) {
    return ok({ doctors: [] });
  }

  const cabinetIds = doctors
    .map((d) => d.schedules[0]?.cabinetId)
    .filter((c): c is string => !!c);

  const [waiting, cabinets] = await Promise.all([
    prisma.appointment.groupBy({
      by: ["doctorId"],
      where: {
        clinicId: ctx.clinicId,
        doctorId: { in: doctors.map((d) => d.id) },
        date: { gte: dayStart, lt: dayEnd },
        queueStatus: { in: ["WAITING", "IN_PROGRESS"] },
      },
      _count: { _all: true },
    }),
    cabinetIds.length > 0
      ? prisma.cabinet.findMany({
          where: { clinicId: ctx.clinicId, id: { in: cabinetIds } },
          select: { id: true, number: true },
        })
      : Promise.resolve([] as { id: string; number: string }[]),
  ]);

  const out = doctors.map((d) => {
    const w = waiting.find((x) => x.doctorId === d.id)?._count._all ?? 0;
    const cabId = d.schedules[0]?.cabinetId;
    const cab = cabId ? cabinets.find((c) => c.id === cabId) : null;
    return {
      id: d.id,
      nameRu: d.nameRu,
      nameUz: d.nameUz,
      specializationRu: d.specializationRu,
      specializationUz: d.specializationUz,
      photoUrl: d.photoUrl,
      color: d.color,
      cabinet: cab?.number ?? null,
      pricePerVisit: d.pricePerVisit,
      waitingCount: w,
      etaMinutes: w * 30,
    };
  });

  return ok({ doctors: out });
});
