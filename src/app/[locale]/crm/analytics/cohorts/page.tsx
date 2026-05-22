import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { auditServerPage } from "@/lib/audit-server";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveCohortRetention } from "@/server/analytics/cohort-resolver";
import { trailingMonths } from "@/lib/analytics/dashboard-math";

import { CohortHeatmapClient } from "./_components/cohort-heatmap-client";

/**
 * /crm/analytics/cohorts — Phase 18 Wave 2.
 *
 * Reads the W1 `mv_cohort_retention` resolver server-side so the heatmap
 * has data on first paint (no extra HTTP round-trip). The matrix already
 * carries every cohort over the last 24 months; we trim the default view
 * to the last 12 here and let the toolbar widen it on the client.
 *
 * ADMIN-only — non-admins land on a 404 (matches Phase 9d's pattern of not
 * disclosing pro surfaces).
 */
export default async function CohortAnalyticsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
    notFound();
  }
  if (!session.user.clinicId) notFound();

  const matrix = await runWithTenant(
    {
      kind: "TENANT",
      clinicId: session.user.clinicId,
      userId: session.user.id,
      role: session.user.role,
    },
    () => resolveCohortRetention(prisma, session.user.clinicId as string),
  );

  const defaultRange = trailingMonths(new Date(), 12);
  await auditServerPage({
    action: AUDIT_ACTION.ANALYTICS_REPORT_RUN,
    entityType: "AnalyticsView",
    entityId: null,
    meta: {
      dashboard: "cohorts",
      filters: { fromMonth: defaultRange.fromMonth, toMonth: defaultRange.toMonth },
    },
  });

  return (
    <CohortHeatmapClient
      matrix={matrix}
      defaultFromMonth={defaultRange.fromMonth}
      defaultToMonth={defaultRange.toMonth}
    />
  );
}
