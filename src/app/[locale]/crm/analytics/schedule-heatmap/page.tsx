import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { auditServerPage } from "@/lib/audit-server";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveScheduleHeatmap } from "@/server/analytics/schedule-heatmap-resolver";

import { ScheduleHeatmapClient } from "./_components/schedule-heatmap-client";

/**
 * /crm/analytics/schedule-heatmap — Phase 18 Wave 2.
 *
 * Visits and free working hours per doctor × ISO weekday × Tashkent hour
 * over the 90 days before today, counted live (schedule-heatmap-resolver.ts,
 * audit AN-24). The client lays out a 7×24 grid with a "All doctors"
 * aggregate plus a per-doctor selector.
 *
 * ADMIN-only.
 */
export default async function ScheduleHeatmapPage({
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

  const tenant = {
    kind: "TENANT" as const,
    clinicId: session.user.clinicId,
    userId: session.user.id,
    role: session.user.role,
  };

  const [heatmap, doctors] = await runWithTenant(tenant, () =>
    Promise.all([
      resolveScheduleHeatmap(prisma, session.user.clinicId as string),
      prisma.doctor.findMany({
        where: { clinicId: session.user.clinicId as string, isActive: true },
        select: { id: true, nameRu: true, nameUz: true },
        orderBy: { nameRu: "asc" },
      }),
    ]),
  );

  await auditServerPage({
    action: AUDIT_ACTION.ANALYTICS_REPORT_RUN,
    entityType: "AnalyticsView",
    entityId: null,
    meta: {
      dashboard: "schedule-heatmap",
      filters: { window: "90d" },
    },
  });

  return (
    <ScheduleHeatmapClient
      cells={heatmap.cells}
      generatedAt={heatmap.generatedAt}
      doctors={doctors}
    />
  );
}
