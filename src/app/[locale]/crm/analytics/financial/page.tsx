import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { auditServerPage } from "@/lib/audit-server";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import {
  FINANCIAL_TREND_DAYS,
  resolveFinancialPace,
} from "@/server/analytics/financial-pace-resolver";

import { FinancialDashboardClient } from "./_components/financial-dashboard-client";

/**
 * /crm/analytics/financial — Phase 18 Wave 2.
 *
 * Renders the same `mv_financial_pace` MV that powers
 * `GET /api/crm/analytics/financial`, so the first paint already has data.
 * The client polls the API every 60s with the same window
 * (`financialWindow`, 90 Tashkent days through the month end); the SSR
 * snapshot is just a seed (audit AN-25).
 *
 * ADMIN-only — non-admins land on a 404 (Phase 9d's pattern). SUPER_ADMIN
 * is allowed when they have impersonated a clinic (clinicId on the session),
 * so platform owners can review tenant analytics without a separate UI.
 */
export default async function FinancialAnalyticsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
    notFound();
  }
  if (!session.user.clinicId) notFound();

  const now = new Date();

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
        { trendDays: FINANCIAL_TREND_DAYS },
        now,
      ),
  );

  await auditServerPage({
    action: AUDIT_ACTION.ANALYTICS_REPORT_RUN,
    entityType: "AnalyticsView",
    entityId: null,
    meta: {
      dashboard: "financial",
      filters: snapshot.range,
    },
  });

  return <FinancialDashboardClient initialSnapshot={snapshot} />;
}
