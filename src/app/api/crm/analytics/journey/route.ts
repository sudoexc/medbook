/**
 * /api/crm/analytics/journey — the «Путь пациента» strip of the analytics
 * dashboard: new patients, repeat visits, average check, each counted over
 * real rows (definitions in src/server/analytics/patient-journey.ts).
 *
 * Replaces /api/crm/analytics/cases, whose MedicalCase KPIs only ever fed
 * the strip's made-up coefficients (audit AN-15).
 *
 *   { period, from, to, doctorOnly, journey: PatientJourney }
 *
 * Period: ?period=week|month|quarter or ?from=&to= (resolveAnalyticsRange).
 * RBAC mirrors /api/crm/analytics: ADMIN sees the clinic, a DOCTOR only
 * their own visits. A DOCTOR login with no Doctor row gets an empty strip
 * rather than the whole clinic's numbers.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { resolveAnalyticsRange } from "@/server/analytics/range";
import {
  EMPTY_JOURNEY,
  loadPatientJourney,
} from "@/server/analytics/patient-journey";
import { paymentsRecordedSince } from "@/server/patient/finance";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request, ctx }) => {
    const url = new URL(request.url);
    const { from, to, period } = resolveAnalyticsRange(url);
    const window = { period, from: from.toISOString(), to: to.toISOString() };

    let doctorId: string | null = null;
    if (ctx.kind === "TENANT" && ctx.role === "DOCTOR") {
      const doctor = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (!doctor) {
        return ok({ ...window, doctorOnly: true, journey: EMPTY_JOURNEY });
      }
      doctorId = doctor.id;
    }

    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    const paymentsTracked = clinicId
      ? (await paymentsRecordedSince(clinicId)) !== null
      : false;

    const journey = await loadPatientJourney(prisma, {
      from,
      to,
      doctorId,
      paymentsTracked,
    });
    return ok({ ...window, doctorOnly: doctorId !== null, journey });
  },
);
