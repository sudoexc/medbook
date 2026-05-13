import Link from "next/link";
import { ArrowLeftIcon, ChevronDownIcon, UploadIcon } from "lucide-react";

import { AISummaryPanel } from "./_components/ai-summary-panel";
import { LastDiagnosisCard } from "./_components/last-diagnosis-card";
import { LastVisitCard } from "./_components/last-visit-card";
import { PatientHeader } from "./_components/patient-header";
import { PatientMetaRow } from "./_components/patient-meta-row";
import { VisitComparison } from "./_components/visit-comparison";
import { VisitsFilters } from "./_components/visits-filters";
import { VisitsTable } from "./_components/visits-table";
import { VisitsTimeline } from "./_components/visits-timeline";

export default async function ReceptionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <div className="flex gap-4 p-4 xl:gap-5 xl:p-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4 xl:gap-5">
        <Link
          href={`/${locale}/doctor/patients`}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeftIcon className="size-4" />
          К списку пациентов
        </Link>

        <PatientHeader />
        <PatientMetaRow />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-foreground">История визитов</h1>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <UploadIcon className="size-4 text-muted-foreground" />
            Экспорт
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          </button>
        </div>

        <VisitsFilters />
        <VisitsTimeline />
        <VisitsTable />
      </div>

      <aside className="hidden w-[320px] shrink-0 flex-col gap-4 xl:flex xl:gap-5">
        <AISummaryPanel />
        <LastVisitCard />
        <LastDiagnosisCard />
        <VisitComparison />
      </aside>
    </div>
  );
}
