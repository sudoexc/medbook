/**
 * GET /api/c/[slug]/queue/board
 *
 * Public TV waiting-room board. Returns today's active doctors with their
 * current patient + waiting queue. Polled by the TV display every few seconds
 * (or wired to SSE later).
 *
 * Shape:
 *   {
 *     clinic: { nameRu, nameUz, phone, addressRu, addressUz },
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
import { getQueueProjection } from "@/server/appointments/queue-projection";
import { tashkentComponents } from "@/lib/booking-validation";
import { initials } from "@/lib/format";

export const dynamic = "force-dynamic";

export const GET = createPublicClinicHandler(async ({ ctx }) => {
  // Tashkent wall-clock weekday — server runs UTC, so a naive day pick would
  // choose the wrong schedule weekday near midnight.
  const weekday = tashkentComponents(new Date()).dow;

  // Cabinet is now bound to the doctor (Phase 11) — pull it via the relation
  // instead of going through DoctorSchedule.cabinetId, which no longer exists.
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
      cabinet: { select: { number: true } },
    },
    orderBy: { nameRu: "asc" },
  });

  if (doctors.length === 0) {
    return ok({
      clinic: {
        nameRu: ctx.clinicNameRu,
        nameUz: ctx.clinicNameUz,
        phone: ctx.clinicPhone,
        addressRu: ctx.clinicAddressRu,
        addressUz: ctx.clinicAddressUz,
      },
      now: new Date().toISOString(),
      doctors: [],
    });
  }

  const doctorIds = doctors.map((d) => d.id);
  const projection = await getQueueProjection({
    clinicId: ctx.clinicId,
    doctorIds,
  });

  const out = doctors.map((d) => {
    const q = projection.get(d.id);
    return {
      id: d.id,
      nameRu: d.nameRu,
      nameUz: d.nameUz,
      specializationRu: d.specializationRu,
      specializationUz: d.specializationUz,
      photoUrl: d.photoUrl,
      color: d.color,
      cabinet: d.cabinet?.number ?? null,
      // Public TV — minimize PII to initials ("Иванов И. П."), same posture as
      // the legacy /api/tv-queue this replaces.
      current: q?.current
        ? {
            fullName: initials(q.current.patientFullName),
            ticketNumber: q.current.ticketNumber,
            startedAt: q.current.startedAt?.toISOString() ?? null,
          }
        : null,
      waiting: (q?.waiting ?? []).map((w) => ({
        id: w.appointmentId,
        fullName: initials(w.patientFullName),
        ticketNumber: w.ticketNumber,
        queueOrder: w.queueOrder,
        etaMinutes: w.etaMinutes,
      })),
    };
  });

  return ok({
    clinic: {
      nameRu: ctx.clinicNameRu,
      nameUz: ctx.clinicNameUz,
      phone: ctx.clinicPhone,
      addressRu: ctx.clinicAddressRu,
      addressUz: ctx.clinicAddressUz,
    },
    now: new Date().toISOString(),
    doctors: out,
  });
});
