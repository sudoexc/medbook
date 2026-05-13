import Link from "next/link";
import { ArrowLeftIcon, ChevronDownIcon, UploadIcon } from "lucide-react";

import { AISummaryPanel } from "../reception/_components/ai-summary-panel";
import { LastDiagnosisCard } from "../reception/_components/last-diagnosis-card";
import { LastVisitCard } from "../reception/_components/last-visit-card";
import { PatientHeader } from "../reception/_components/patient-header";
import { PatientMetaRow } from "../reception/_components/patient-meta-row";
import { VisitComparison } from "../reception/_components/visit-comparison";
import { VisitsFilters } from "../reception/_components/visits-filters";
import { VisitsTable } from "../reception/_components/visits-table";
import { VisitsTimeline } from "../reception/_components/visits-timeline";

export default async function VisitsPage({
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
