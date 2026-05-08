/**
 * Phase 16 Wave 1 — GET /api/miniapp/treatment-plan?clinicSlug=…
 *
 * Returns the patient's most-recent active MedicalCase along with progress:
 *   - completed visit count (Appointments.status = COMPLETED tied to the case)
 *   - next BOOKED appointment (earliest in the future)
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
import { computeProgress } from "@/server/services/treatment-plan";

async function resolveActivePatientId(
  request: Request,
  ctx: { clinicId: string; patientId: string },
): Promise<{ ok: true; patientId: string } | { ok: false; response: Response }> {
  const url = new URL(request.url);
  const onBehalfOf = url.searchParams.get("onBehalfOf");
  if (!onBehalfOf || onBehalfOf === ctx.patientId) {
    return { ok: true, patientId: ctx.patientId };
  }
  // Verify the owner has a PatientFamily link to that patient.
  const link = await prisma.patientFamily.findFirst({
    where: {
      clinicId: ctx.clinicId,
      ownerPatientId: ctx.patientId,
      linkedPatientId: onBehalfOf,
    },
    select: { id: true },
  });
  if (!link) return { ok: false, response: err("forbidden_relative", 403) };
  return { ok: true, patientId: onBehalfOf };
}

export const GET = createMiniAppListHandler({}, async ({ request, ctx }) => {
  const resolved = await resolveActivePatientId(request, ctx);
  if (!resolved.ok) return resolved.response;
  const patientId = resolved.patientId;

  const openCases = await prisma.medicalCase.findMany({
    where: { clinicId: ctx.clinicId, patientId, status: "OPEN" },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
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

  const now = new Date();
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
        status: "BOOKED",
        date: { gte: now },
      },
      orderBy: { date: "asc" },
      select: { id: true, date: true, time: true },
    }),
  ]);

  const progress = computeProgress({
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
