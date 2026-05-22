import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import {
  paginate,
  SAVED_REPORT_PAGE_SIZE,
  type SavedReportListResponse,
} from "@/server/analytics/saved-reports";
import type { ReportConfig } from "@/server/analytics/report-config";

import { ReportsListClient } from "./_components/reports-list-client";

/**
 * /crm/analytics/reports — saved reports landing.
 *
 * SSR-renders the first page so the client has data on first paint and
 * can switch pages via the API. ADMIN-only, with SUPER_ADMIN allowed when
 * they've impersonated a clinic (matches api-handler's checkRoles bypass).
 */
export default async function SavedReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
    notFound();
  }
  if (!session.user.clinicId) notFound();

  const lang: "ru" | "uz" = locale === "uz" ? "uz" : "ru";

  const initial = await runWithTenant(
    {
      kind: "TENANT",
      clinicId: session.user.clinicId,
      userId: session.user.id,
      role: session.user.role,
    },
    async (): Promise<SavedReportListResponse> => {
      const total = await prisma.savedReport.count({});
      const page = paginate({ page: 1, pageSize: SAVED_REPORT_PAGE_SIZE, total });
      const rows = await prisma.savedReport.findMany({
        orderBy: [{ lastRunAt: "desc" }, { createdAt: "desc" }],
        take: page.pageSize,
        skip: page.offset,
        select: {
          id: true,
          name: true,
          description: true,
          createdAt: true,
          lastRunAt: true,
          createdByUserId: true,
          config: true,
          createdBy: { select: { name: true, email: true } },
        },
      });
      return {
        rows: rows.map((r) => {
          const cfg = (r.config ?? {}) as Partial<ReportConfig>;
          return {
            id: r.id,
            name: r.name,
            description: r.description ?? null,
            createdByUserId: r.createdByUserId,
            createdByLabel: r.createdBy?.name ?? r.createdBy?.email ?? null,
            createdAt: r.createdAt.toISOString(),
            lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
            dimensionsCount: Array.isArray(cfg.dimensions)
              ? cfg.dimensions.length
              : 0,
            measuresCount: Array.isArray(cfg.measures)
              ? cfg.measures.length
              : 0,
          };
        }),
        pagination: page,
      };
    },
  );

  return <ReportsListClient locale={lang} initial={initial} />;
}
