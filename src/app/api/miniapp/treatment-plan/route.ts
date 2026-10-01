/**
 * Phase 16 Wave 1 — GET /api/miniapp/treatment-plan?clinicSlug=…
 *
 * Returns the patient's most-recent active MedicalCase along with progress:
 *   - completed visit count (Appointments.status = COMPLETED tied to the case)
 *   - next upcoming appointment (BOOKED, CONFIRMED or WAITING, from today)
 *   - count of OTHER open cases (so the UI can render "+N more")
 *
 * Honours `?onBehalfOf=<patientId>` — when present, validates that the TG
 * owner is linked to that patient via PatientFamily and runs the query
 * against the relative's case instead of the owner's.
 *
 * The shape is shaped for direct consumption by `<TreatmentPlanCard>` —
 * progress arithmetic stays on the server so RU/UZ format helpers don't
 * need to be duplicated client-side.
 */
import { prisma } from "@/lib/prisma";
import { err, ok } from "@/server/http";
import { createMiniAppListHandler } from "@/server/miniapp/handler";
import { resolveActivePatient } from "@/server/miniapp/active-patient";
import { computeProgress } from "@/server/services/treatment-plan";
import { UPCOMING_VISIT_STATUSES } from "@/lib/appointments/active-statuses";
import { tashkentDayBounds } from "@/lib/booking-validation";

export const GET = createMiniAppListHandler({}, async ({ request, ctx }) => {
  const onBehalfOf = new URL(request.url).searchParams.get("onBehalfOf");
  const acting = await resolveActivePatient({
    ctx: {
      clinicId: ctx.clinicId,
      patientId: ctx.patientId,
      preferredLang: ctx.patient.preferredLang,
    },
    onBehalfOf,
  });
  if (!acting.ok) return err(acting.reason, 403);
  const patientId = acting.patientId;

  const openCases = await prisma.medicalCase.findMany({
    where: { clinicId: ctx.clinicId, patientId, status: "OPEN" },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      primaryComplaint: true,
      diagnosisText: true,
      openedAt: true,
      primaryDoctor: {
        select: { id: true, nameRu: true, nameUz: true, photoUrl: true },
      },
    },
  });

  if (openCases.length === 0) {
    return ok({ active: null, more: 0 });
  }

  const active = openCases[0]!;
  const more = openCases.length - 1;

  // The next visit is any one still ahead (audit MA-11): phone bookings and
  // reminder answers are CONFIRMED, an arrived patient is WAITING, and a
  // BOOKED-only lookup told them «nothing booked» and offered to book again.
  // From the start of today, like the Mini App's «Предстоящие» (MA-20).
  const { dayStart } = tashkentDayBounds(new Date());
  const [completedCount, nextBooked] = await Promise.all([
    prisma.appointment.count({
      where: {
        clinicId: ctx.clinicId,
        patientId,
        medicalCaseId: active.id,
        status: "COMPLETED",
      },
    }),
    prisma.appointment.findFirst({
      where: {
        clinicId: ctx.clinicId,
        patientId,
        medicalCaseId: active.id,
        status: { in: [...UPCOMING_VISIT_STATUSES] },
        date: { gte: dayStart },
      },
      orderBy: { date: "asc" },
      select: { id: true, date: true, time: true },
    }),
  ]);

  const progress = computeProgress({
    caseStatus: active.status,
    completedAppointments: completedCount,
    nextBookedAt: nextBooked?.date ?? null,
  });

  return ok({
    active: {
      id: active.id,
      title: active.title,
      primaryComplaint: active.primaryComplaint,
      diagnosisText: active.diagnosisText,
      openedAt: active.openedAt,
      primaryDoctor: active.primaryDoctor,
      progress,
      nextBooked: nextBooked
        ? {
            id: nextBooked.id,
            date: nextBooked.date,
            time: nextBooked.time,
          }
        : null,
    },
    more,
  });
});
