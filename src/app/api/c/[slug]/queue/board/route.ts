/**
 * GET /api/c/[slug]/queue/board
 *
 * Public TV waiting-room board. Returns today's active doctors with their
 * current patient + waiting queue. Polled by the TV display every few seconds
 * (or wired to SSE later).
 *
 * Shape:
 *   {
 *     clinic: { nameRu, nameUz },
 *     now: ISO,
 *     doctors: [{
 *       id, nameRu, nameUz, specializationRu, specializationUz,
 *       photoUrl, color, cabinet,
 *       current: { fullName, ticketNumber, startedAt } | null,
 *       waiting: [{ id, fullName, ticketNumber, queueOrder, etaMinutes }],
 *     }],
 *   }
 */
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { createPublicClinicHandler } from "@/server/clinic-public/resolve";
import { ticketNumberFor } from "@/server/services/ticket-number";

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
      schedules: {
        where: { weekday, isActive: true },
        select: { cabinetId: true, startTime: true, endTime: true },
        take: 1,
      },
    },
    orderBy: { nameRu: "asc" },
  });

  if (doctors.length === 0) {
    return ok({
      clinic: { nameRu: ctx.clinicNameRu, nameUz: ctx.clinicNameUz },
      now: new Date().toISOString(),
      doctors: [],
    });
  }

  const doctorIds = doctors.map((d) => d.id);
  const cabinetIds = doctors
    .map((d) => d.schedules[0]?.cabinetId)
    .filter((c): c is string => !!c);

  const [appts, cabinets] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        clinicId: ctx.clinicId,
        doctorId: { in: doctorIds },
        date: { gte: dayStart, lt: dayEnd },
        queueStatus: { in: ["WAITING", "IN_PROGRESS"] },
      },
      select: {
        id: true,
        doctorId: true,
        queueStatus: true,
        queueOrder: true,
        startedAt: true,
        durationMin: true,
        patient: { select: { fullName: true } },
      },
      orderBy: [{ queueStatus: "asc" }, { queueOrder: "asc" }],
    }),
    cabinetIds.length > 0
      ? prisma.cabinet.findMany({
          where: { clinicId: ctx.clinicId, id: { in: cabinetIds } },
          select: { id: true, number: true },
        })
      : Promise.resolve([] as { id: string; number: string }[]),
  ]);

  const cabinetByDoc = new Map<string, string | null>();
  for (const d of doctors) {
    const cabId = d.schedules[0]?.cabinetId;
    const cab = cabId ? cabinets.find((c) => c.id === cabId) : null;
    cabinetByDoc.set(d.id, cab?.number ?? null);
  }

  const out = doctors.map((d) => {
    const own = appts.filter((a) => a.doctorId === d.id);
    const inProgress = own.find((a) => a.queueStatus === "IN_PROGRESS");
    const waiting = own
      .filter((a) => a.queueStatus === "WAITING")
      .sort((a, b) => (a.queueOrder ?? 0) - (b.queueOrder ?? 0));

    // Average duration for ETA — fall back to first waiting's durationMin or 30.
    const avgDur =
      waiting.length > 0
        ? Math.round(
            waiting.reduce((s, w) => s + (w.durationMin ?? 30), 0) /
              waiting.length,
          )
        : 30;

    return {
      id: d.id,
      nameRu: d.nameRu,
      nameUz: d.nameUz,
      specializationRu: d.specializationRu,
      specializationUz: d.specializationUz,
      photoUrl: d.photoUrl,
      color: d.color,
      cabinet: cabinetByDoc.get(d.id) ?? null,
      current: inProgress
        ? {
            fullName: inProgress.patient.fullName,
            ticketNumber: ticketNumberFor(d.id, inProgress.queueOrder),
            startedAt: inProgress.startedAt?.toISOString() ?? null,
          }
        : null,
      waiting: waiting.map((w, idx) => ({
        id: w.id,
        fullName: w.patient.fullName,
        ticketNumber: ticketNumberFor(d.id, w.queueOrder),
        queueOrder: w.queueOrder,
        etaMinutes: avgDur * (idx + (inProgress ? 1 : 0)),
      })),
    };
  });

  return ok({
    clinic: { nameRu: ctx.clinicNameRu, nameUz: ctx.clinicNameUz },
    now: new Date().toISOString(),
    doctors: out,
  });
});
