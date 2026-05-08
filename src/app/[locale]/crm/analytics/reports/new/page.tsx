import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import { ReportBuilderClient } from "../_components/report-builder-client";

/**
 * /crm/analytics/reports/new — Phase 18 Wave 3 builder entry.
 *
 * SSR loads branches + doctors so the filter chips have data on first
 * paint (no extra HTTP round-trip). ADMIN-only — non-admins land on 404
 * matching the W2 dashboards.
 */
export default async function NewReportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  if (session.user.role !== "ADMIN") notFound();
  if (!session.user.clinicId) notFound();

  const lang: "ru" | "uz" = locale === "uz" ? "uz" : "ru";

  const [branches, doctors] = await runWithTenant(
    {
      kind: "TENANT",
      clinicId: session.user.clinicId,
      userId: session.user.id,
      role: session.user.role,
    },
    () =>
      Promise.all([
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
    />
  );
}
