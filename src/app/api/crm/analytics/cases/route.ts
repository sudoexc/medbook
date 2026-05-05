/**
 * /api/crm/analytics/cases — MedicalCase aggregations for the analytics
 * dashboard (TZ §6 + Phase: case metrics).
 *
 * Response shape:
 *   {
 *     period, from, to, doctorOnly,
 *     kpis: {
 *       openCasesTotal:   number   // count of all OPEN cases right now
 *       repeatConvPct:    number   // % of cases (in window) with >1 visit
 *       avgDurationDays:  number   // avg (closedAt-openedAt) for RESOLVED in window
 *       avgRevenuePerCase: number  // sum(payment.amount where appt.medicalCaseId in window cases) / |cases in window|
 *     },
 *     topComplaints: Array<{ complaint: string; count: number }>  // top 10
 *     durationBuckets: Array<{ bucket: "1-7" | "8-14" | "15-30" | ">30"; count: number }>
 *   }
 *
 * Window semantics:
 *   - "in window" = MedicalCase.openedAt ∈ [from, to). This is what
 *     drives complaints + buckets + repeat-conversion + avg-revenue.
 *   - openCasesTotal is global (status=OPEN regardless of window) — that's the
 *     KPI users actually want ("how many cases are currently open").
 *   - avgDurationDays uses RESOLVED cases CLOSED in the window, since open
 *     cases don't have a duration yet.
 *
 * RBAC mirrors /api/crm/analytics: ADMIN sees everything, DOCTOR is scoped
 * to their own primaryDoctor cases.
 *
 * Tenant scoping via the Prisma extension (MedicalCase + Appointment +
 * Payment all carry clinicId).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { getTenant } from "@/lib/tenant-context";
import { resolveAnalyticsRange } from "@/server/analytics/range";

type DurationBucket = "1-7" | "8-14" | "15-30" | ">30";

function bucketOfDays(days: number): DurationBucket {
  if (days <= 7) return "1-7";
  if (days <= 14) return "8-14";
  if (days <= 30) return "15-30";
  return ">30";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request }) => {
    const url = new URL(request.url);
    const { from, to, period } = resolveAnalyticsRange(url);

    const ctx = getTenant();
    const userId =
      ctx?.kind === "TENANT" && ctx.role === "DOCTOR" ? ctx.userId : null;

    const doctorRow = userId
      ? await prisma.doctor.findFirst({
          where: { userId },
          select: { id: true },
        })
      : null;
    const doctorId = doctorRow?.id ?? null;

    const doctorScope = doctorId ? { primaryDoctorId: doctorId } : {};

    // ── Cases opened in window ────────────────────────────────────────────
    const windowCases = await prisma.medicalCase.findMany({
      where: {
        openedAt: { gte: from, lt: to },
        ...doctorScope,
      },
      select: {
        id: true,
        primaryComplaint: true,
        status: true,
        openedAt: true,
        closedAt: true,
      },
    });

    // ── KPI: open cases total (global, ignores window) ────────────────────
    const openCasesTotal = await prisma.medicalCase.count({
      where: { status: "OPEN", ...doctorScope },
    });

    // ── KPI: repeat conversion (% of window cases with >1 attached visit) ─
    //   + revenue per case (sum PAID payments / |window cases|).
    // One groupBy + one aggregate, O(1) round-trips.
    const caseIdsInWindow = windowCases.map((c) => c.id);
    let repeatConvPct = 0;
    let revenueSum = 0;
    if (caseIdsInWindow.length > 0) {
      const apptCounts = await prisma.appointment.groupBy({
        by: ["medicalCaseId"],
        where: { medicalCaseId: { in: caseIdsInWindow } },
        _count: { _all: true },
      });
      const casesWithMultiple = apptCounts.filter(
        (r) => r._count._all > 1,
      ).length;
      repeatConvPct =
        Math.round((casesWithMultiple / caseIdsInWindow.length) * 1000) / 10;

      const paid = await prisma.payment.aggregate({
        where: {
          status: "PAID",
          appointment: { medicalCaseId: { in: caseIdsInWindow } },
        },
        _sum: { amount: true },
      });
      revenueSum = paid._sum.amount ?? 0;
    }
    const avgRevenuePerCase =
      caseIdsInWindow.length > 0
        ? Math.round(revenueSum / caseIdsInWindow.length)
        : 0;

    // ── KPI: avg duration of cases CLOSED in window ───────────────────────
    const resolvedClosedInWindow = await prisma.medicalCase.findMany({
      where: {
        status: "RESOLVED",
        closedAt: { gte: from, lt: to },
        ...doctorScope,
      },
      select: { openedAt: true, closedAt: true },
    });
    let avgDurationDays = 0;
    if (resolvedClosedInWindow.length > 0) {
      let totalMs = 0;
      let n = 0;
      for (const c of resolvedClosedInWindow) {
        if (!c.closedAt) continue;
        totalMs += c.closedAt.getTime() - c.openedAt.getTime();
        n += 1;
      }
      if (n > 0) {
        avgDurationDays = Math.round(totalMs / n / (24 * 60 * 60 * 1000));
      }
    }

    // ── Top complaints (window-scoped) ────────────────────────────────────
    const complaintCount = new Map<string, number>();
    for (const c of windowCases) {
      const key = (c.primaryComplaint ?? "").trim();
      if (!key) continue;
      complaintCount.set(key, (complaintCount.get(key) ?? 0) + 1);
    }
    const topComplaints = [...complaintCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([complaint, count]) => ({ complaint, count }));

    // ── Duration buckets (window-scoped) ──────────────────────────────────
    // For OPEN cases use (now - openedAt); for RESOLVED use (closed - opened).
    // ABANDONED/TRANSFERRED count toward duration only if closedAt is set.
    const buckets: Record<DurationBucket, number> = {
      "1-7": 0,
      "8-14": 0,
      "15-30": 0,
      ">30": 0,
    };
    const now = new Date();
    for (const c of windowCases) {
      const end =
        c.closedAt ?? (c.status === "OPEN" ? now : null);
      if (!end) continue;
      const days = Math.max(
        1,
        Math.round(
          (end.getTime() - c.openedAt.getTime()) / (24 * 60 * 60 * 1000),
        ),
      );
      buckets[bucketOfDays(days)] += 1;
    }
    const durationBuckets: Array<{ bucket: DurationBucket; count: number }> = [
      { bucket: "1-7", count: buckets["1-7"] },
      { bucket: "8-14", count: buckets["8-14"] },
      { bucket: "15-30", count: buckets["15-30"] },
      { bucket: ">30", count: buckets[">30"] },
    ];

    return ok({
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      doctorOnly: Boolean(doctorId),
      kpis: {
        openCasesTotal,
        repeatConvPct,
        avgDurationDays,
        avgRevenuePerCase,
      },
      topComplaints,
      durationBuckets,
    });
  },
);
