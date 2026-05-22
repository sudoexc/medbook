import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { parseReportConfig } from "@/server/analytics/report-config";

import { ReportBuilderClient } from "../../_components/report-builder-client";

/**
 * /crm/analytics/reports/[id]/edit — same builder UI, pre-filled.
 */
export default async function EditReportPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
    notFound();
  }
  if (!session.user.clinicId) notFound();

  const lang: "ru" | "uz" = locale === "uz" ? "uz" : "ru";

  const [row, branches, doctors] = await runWithTenant(
    {
      kind: "TENANT",
      clinicId: session.user.clinicId,
      userId: session.user.id,
      role: session.user.role,
    },
    () =>
      Promise.all([
        prisma.savedReport.findFirst({
          where: { id },
          select: {
            id: true,
            name: true,
            description: true,
            config: true,
          },
        }),
        prisma.branch.findMany({
          where: { isActive: true },
          orderBy: [{ isDefault: "desc" }, { nameRu: "asc" }],
          select: { id: true, nameRu: true, nameUz: true },
        }),
        prisma.doctor.findMany({
          where: { isActive: true },
          orderBy: { nameRu: "asc" },
          select: { id: true, nameRu: true, nameUz: true },
        }),
      ]),
  );
  if (!row) notFound();

  let config;
  try {
    config = parseReportConfig(row.config);
  } catch {
    notFound();
  }

  return (
    <ReportBuilderClient
      locale={lang}
      branches={branches.map((b) => ({
        id: b.id,
        label: lang === "uz" ? b.nameUz : b.nameRu,
      }))}
      doctors={doctors.map((d) => ({
        id: d.id,
        label: lang === "uz" ? d.nameUz : d.nameRu,
      }))}
      initialReport={{
        id: row.id,
        name: row.name,
        description: row.description ?? null,
        config,
      }}
    />
  );
}
