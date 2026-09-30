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
 *       current: { id, fullName, ticketNumber, startedAt } | null,
 *       waiting: [{ id, fullName, ticketNumber, queueOrder, etaMinutes }],
 *     }],
 *   }
 *
 * Row `id`s are `boardRowKey`s, not appointment ids (audit INF-10).
 */
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { createPublicClinicHandler } from "@/server/clinic-public/resolve";
import { getQueueProjection } from "@/server/appointments/queue-projection";
import { loadOnDutyDoctorIds } from "@/server/doctors/on-duty";
import { initials } from "@/lib/format";
import { boardRowKey } from "@/server/appointments/public-ticket";

export const dynamic = "force-dynamic";

export const GET = createPublicClinicHandler(async ({ ctx }) => {
  // Cabinet is now bound to the doctor (Phase 11) — pull it via the relation
  // instead of going through DoctorSchedule.cabinetId, which no longer exists.
  // Who is on the board is decided below by the real schedule and today's
  // queue (Q-08), not by a weekday row.
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
      cabinet: { select: { number: true } },
    },
    orderBy: { nameRu: "asc" },
  });
  // Q-08 — a doctor on leave or past his schedule's end is off the TV; a
  // doctor with patients in his queue today is on it, schedule or not.
  const onDuty = await loadOnDutyDoctorIds(prisma, {
    clinicId: ctx.clinicId,
    doctorIds: activeDoctors.map((d) => d.id),
  });
  const doctors = activeDoctors.filter((d) => onDuty.has(d.id));

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
            // Opaque row key, like the waiting rows carry: the TV matches a
            // `queue.called` to this row, never to whoever is current (Q-10).
            // Never the appointment id itself on this anonymous screen (INF-10).
            id: boardRowKey(q.current.appointmentId),
            fullName: initials(q.current.patientFullName),
            ticketNumber: q.current.ticketNumber,
            startedAt: q.current.startedAt?.toISOString() ?? null,
          }
        : null,
      waiting: (q?.waiting ?? []).map((w) => ({
        id: boardRowKey(w.appointmentId),
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
