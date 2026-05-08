import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { auditServerPage } from "@/lib/audit-server";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveDoctorPerformance } from "@/server/analytics/doctor-performance-resolver";
import { resolveDoctorPerfRange } from "@/lib/analytics/dashboard-math";

import { DoctorPerformanceClient } from "./_components/doctor-performance-client";

/**
 * /crm/analytics/doctors — Phase 18 Wave 2.
 *
 * Default window is the trailing 30 days; the toolbar lets the admin widen
 * to 90 days, year-to-date, or pick a custom range. We hand the client both
 * the aggregated rows for the default window AND a per-month sparkline
 * series (last 6 months) so each row gets a tiny SVG trend line without an
 * extra HTTP round-trip.
 */
export default async function DoctorPerformancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  if (session.user.role !== "ADMIN") notFound();
  if (!session.user.clinicId) notFound();

  const now = new Date();
  const range = resolveDoctorPerfRange("30d", now);

  // Six months of sparkline data — identical clinicId scope, narrower window.
  const sparkFrom = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1),
  );
  const sparkTo = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );

  const tenant = {
    kind: "TENANT" as const,
    clinicId: session.user.clinicId,
    userId: session.user.id,
    role: session.user.role,
  };

  const [perf, sparkRaw, doctors] = await runWithTenant(tenant, async () => {
    const [perf, doctors] = await Promise.all([
      resolveDoctorPerformance(prisma, session.user.clinicId as string, {
        monthFrom: range.from,
        monthTo: range.to,
        limit: 200,
      }),
      prisma.doctor.findMany({
        where: { clinicId: session.user.clinicId as string, isActive: true },
        select: { id: true, nameRu: true, nameUz: true },
        orderBy: { nameRu: "asc" },
      }),
    ]);
    // Sparkline rows — fetched per-month so the client can plot them as a
    // tiny inline SVG. We re-use the same MV but with a 6-month window.
    const sparkRaw = await prisma.$queryRawUnsafe<
      Array<{
        doctorId: string;
        month: Date;
        revenueTiins: bigint | number;
        visitsCount: bigint | number;
      }>
    >(
      `SELECT "doctorId", "month", "revenueTiins", "visitsCount"
       FROM "mv_doctor_performance"
       WHERE "clinicId" = $1 AND "month" >= $2 AND "month" < $3
       ORDER BY "doctorId", "month" ASC`,
      session.user.clinicId,
      sparkFrom,
      sparkTo,
    );
    return [perf, sparkRaw, doctors];
  });

  const sparklines: Record<
    string,
    Array<{ month: string; revenueTiins: number; visitsCount: number }>
  > = {};
  for (const r of sparkRaw) {
    const m = new Date(r.month);
    const key = `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
    const arr = sparklines[r.doctorId] ?? [];
    arr.push({
      month: key,
      revenueTiins: Number(r.revenueTiins),
      visitsCount: Number(r.visitsCount),
    });
    sparklines[r.doctorId] = arr;
  }

  await auditServerPage({
    action: AUDIT_ACTION.ANALYTICS_REPORT_RUN,
    entityType: "AnalyticsView",
    entityId: null,
    meta: {
      dashboard: "doctors",
      filters: {
        rangeKind: "30d",
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
    },
  });

  return (
    <DoctorPerformanceClient
      initialRows={perf.rows}
      generatedAt={perf.generatedAt}
      doctors={doctors}
      sparklines={sparklines}
    />
  );
}
