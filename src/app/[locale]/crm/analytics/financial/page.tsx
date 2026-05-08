import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { auditServerPage } from "@/lib/audit-server";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveFinancialPace } from "@/server/analytics/financial-pace-resolver";

import { FinancialDashboardClient } from "./_components/financial-dashboard-client";

/**
 * /crm/analytics/financial — Phase 18 Wave 2.
 *
 * Renders the same `mv_financial_pace` MV that powers
 * `GET /api/crm/analytics/financial`, so the first paint already has data.
 * The client polls the API every 60s for live numbers; the SSR snapshot
 * is just a seed.
 *
 * The MV row spans 90 days back through 30 days forward. We hand the
 * client both the active-month snapshot (for the KPI cards) AND a 90-day
 * window (for the trend chart) by widening the `dayFrom` bound.
 *
 * ADMIN-only — non-admins land on a 404 (Phase 9d's pattern).
 */
export default async function FinancialAnalyticsPage({
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
  // Pull a 90-day-back-through-end-of-month window so the trend chart and
  // the MTD card both come out of one resolver call.
  const dayFrom = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 89),
  );
  const dayTo = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );

  const snapshot = await runWithTenant(
    {
      kind: "TENANT",
      clinicId: session.user.clinicId,
      userId: session.user.id,
      role: session.user.role,
    },
    () =>
      resolveFinancialPace(
        prisma,
        session.user.clinicId as string,
        { dayFrom, dayTo },
        now,
      ),
  );

  await auditServerPage({
    action: AUDIT_ACTION.ANALYTICS_REPORT_RUN,
    entityType: "AnalyticsView",
    entityId: null,
    meta: {
      dashboard: "financial",
      filters: {
        dayFrom: dayFrom.toISOString(),
        dayTo: dayTo.toISOString(),
      },
    },
  });

  return <FinancialDashboardClient initialSnapshot={snapshot} />;
}
