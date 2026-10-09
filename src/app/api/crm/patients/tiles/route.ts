/**
 * GET /api/crm/patients/tiles — the KPI tiles above the patients list,
 * counted over the clinic's whole base (audit PT-13; definitions in
 * src/server/patient/list-tiles.ts).
 *
 *   { total, newThisWeek, active, dormant,
 *     avgCheck: { visible, paymentsTracked, value } }
 *
 * The average check is the analytics «Путь пациента» figure for the last
 * 30 days and follows its access: ADMIN sees the clinic, a DOCTOR his own
 * visits, other roles do not get it. The platform owner inside a clinic sees
 * it as its admin does (owner request 09.10.2026).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { isClinicAdmin } from "@/lib/permissions/clinic-admin";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { loadPatientCounts, type PatientTiles } from "@/server/patient/list-tiles";
import { resolveAnalyticsRange } from "@/server/analytics/range";
import { loadPatientJourney } from "@/server/analytics/patient-journey";
import { paymentsRecordedSince } from "@/server/patient/finance";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") {
      return ok({
        total: 0,
        newThisWeek: 0,
        active: 0,
        dormant: 0,
        avgCheck: { visible: false, paymentsTracked: false, value: null },
      } satisfies PatientTiles);
    }
    const now = new Date();
    const counts = await loadPatientCounts(prisma, { clinicId: ctx.clinicId, now });

    const avgCheck: PatientTiles["avgCheck"] = {
      visible: false,
      paymentsTracked: false,
      value: null,
    };
    if (isClinicAdmin(ctx.role) || ctx.role === "DOCTOR") {
      avgCheck.visible = true;
      avgCheck.paymentsTracked = (await paymentsRecordedSince(ctx.clinicId)) !== null;
      // Nothing to average while payments are not recorded: the strip says
      // so instead of a number (AN-15).
      if (avgCheck.paymentsTracked) {
        let doctorId: string | null = null;
        let scoped = true;
        if (ctx.role === "DOCTOR") {
          const doctor = await prisma.doctor.findFirst({
            where: { userId: ctx.userId },
            select: { id: true },
          });
          doctorId = doctor?.id ?? null;
          // A DOCTOR login without a Doctor row sees no clinic money.
          scoped = doctorId !== null;
        }
        if (scoped) {
          const { from, to } = resolveAnalyticsRange(
            new URL("https://x/?period=month"),
            now,
          );
          const journey = await loadPatientJourney(prisma, {
            from,
            to,
            doctorId,
            paymentsTracked: true,
          });
          avgCheck.value = journey.avgCheck;
        }
      }
    }
    return ok({ ...counts, avgCheck } satisfies PatientTiles);
  },
);
