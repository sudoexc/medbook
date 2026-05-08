import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { parseReportConfig } from "@/server/analytics/report-config";

import { ReportViewClient } from "./_components/report-view-client";

/**
 * /crm/analytics/reports/[id] — view + auto-run a saved report.
 */
export default async function SavedReportViewPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  if (session.user.role !== "ADMIN") notFound();
  if (!session.user.clinicId) notFound();

  const lang: "ru" | "uz" = locale === "uz" ? "uz" : "ru";

  const row = await runWithTenant(
    {
      kind: "TENANT",
      clinicId: session.user.clinicId,
      userId: session.user.id,
      role: session.user.role,
    },
    () =>
      prisma.savedReport.findFirst({
        where: { id },
        select: {
          id: true,
          name: true,
          description: true,
          config: true,
          lastRunAt: true,
        },
      }),
  );
  if (!row) notFound();

  let config;
  try {
    config = parseReportConfig(row.config);
  } catch {
    notFound();
  }

  return (
    <ReportViewClient
      locale={lang}
      report={{
        id: row.id,
        name: row.name,
        description: row.description ?? null,
        config,
        lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
      }}
    />
  );
}
