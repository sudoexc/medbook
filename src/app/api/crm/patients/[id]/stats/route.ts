/**
 * /api/crm/patients/[id]/stats — compact clinical KPIs for the patient.
 *
 * Mirrors the aggregates the patient card hero computes client-side
 * (`patient-hero.tsx`), but server-side over the FULL appointment history so
 * the Telegram inbox right-rail gets accurate no-show% / avg-check without
 * over-fetching the whole appointment list.
 *
 *   visitsCount / ltv / balance / lastVisitAt / segment / birthDate
 *     → denormalised columns on the Patient row.
 *   noShowCount / totalAppointments / noShowPct / avgCheck
 *     → aggregated from Appointment (avgCheck = mean priceFinal of COMPLETED).
 *
 * Appointments are 1:patient, so filtering by patientId is tenant-safe even
 * before the Prisma extension's clinicId injection.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, notFound } from "@/server/http";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // /.../patients/[id]/stats
  return parts[parts.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const patient = await prisma.patient.findUnique({
      where: { id },
      select: {
        segment: true,
        visitsCount: true,
        ltv: true,
        balance: true,
        lastVisitAt: true,
        birthDate: true,
      },
    });
    if (!patient) return notFound();

    const [byStatus, completedAgg] = await Promise.all([
      prisma.appointment.groupBy({
        by: ["status"],
        where: { patientId: id },
        _count: { _all: true },
      }),
      prisma.appointment.aggregate({
        where: { patientId: id, status: "COMPLETED" },
        _avg: { priceFinal: true },
      }),
    ]);

    let totalAppointments = 0;
    let noShowCount = 0;
    for (const r of byStatus) {
      totalAppointments += r._count._all;
      if (r.status === "NO_SHOW") noShowCount = r._count._all;
    }
    const noShowPct =
      totalAppointments > 0
        ? Math.round((noShowCount / totalAppointments) * 100)
        : 0;
    const avgCheck = completedAgg._avg.priceFinal
      ? Math.round(completedAgg._avg.priceFinal)
      : 0;

    return ok({
      segment: patient.segment,
      visitsCount: patient.visitsCount,
      ltv: patient.ltv,
      balance: patient.balance,
      lastVisitAt: patient.lastVisitAt,
      birthDate: patient.birthDate,
      noShowCount,
      totalAppointments,
      noShowPct,
      avgCheck,
    });
  },
);
