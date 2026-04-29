"use client";

import * as React from "react";
import { PlusIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { PageContainer } from "@/components/molecules/page-container";
import { Button } from "@/components/ui/button";

import { usePatientsFilters } from "../_hooks/use-patients-filters";
import {
  flattenPatients,
  usePatientsList,
  type PatientRow,
} from "../_hooks/use-patients-list";
import { PatientsFilters } from "./patients-filters";
import { PatientsTable } from "./patients-table";
import { PatientsTiles } from "./patients-tiles";
import {
  PatientsKpiTabs,
  type PatientsTabKey,
} from "./patients-kpi-tabs";
import { PatientsRightRail } from "./patients-right-rail";
import { NewPatientDialog } from "./new-patient-dialog";
import { ExportButton } from "./export-button";

function ageFrom(birthDate: string | null, nowMs: number): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (!Number.isFinite(d.getTime())) return null;
  const now = new Date(nowMs);
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

const TAB_TO_SEGMENT: Record<
  PatientsTabKey,
  PatientRow["segment"] | undefined
> = {
  all: undefined,
  vip: "VIP",
  new: "NEW",
  active: "ACTIVE",
  dormant: "DORMANT",
  churn: "CHURN",
};

const SEGMENT_TO_TAB: Record<PatientRow["segment"], PatientsTabKey> = {
  VIP: "vip",
  NEW: "new",
  ACTIVE: "active",
  DORMANT: "dormant",
  CHURN: "churn",
};

export function PatientsPageClient() {
  const t = useTranslations("patients");
  const router = useRouter();
  const locale = useLocale();
  const { state, apiFilters, setFilter, clearAll } = usePatientsFilters();
  const [nowMs] = React.useState(() => Date.now());

  const [dialogOpen, setDialogOpen] = React.useState(false);

  const query = usePatientsList(apiFilters);

  const allRows = flattenPatients(query.data);

  const rows: PatientRow[] = React.useMemo(() => {
    if (state.ageMin === undefined && state.ageMax === undefined) return allRows;
    return allRows.filter((p) => {
      const age = ageFrom(p.birthDate, nowMs);
      if (age === null) return false;
      if (state.ageMin !== undefined && age < state.ageMin) return false;
      if (state.ageMax !== undefined && age > state.ageMax) return false;
      return true;
    });
  }, [allRows, state.ageMin, state.ageMax, nowMs]);

  const total = query.data?.pages?.[0]?.total ?? null;
  const segmentCounts = query.data?.pages?.[0]?.segmentCounts ?? null;
  const totalAcrossSegments =
    query.data?.pages?.[0]?.totalAcrossSegments ?? null;

  const hasFilters =
    Boolean(state.q) ||
    Boolean(state.segment) ||
    Boolean(state.gender) ||
    Boolean(state.source) ||
    Boolean(state.tag) ||
    Boolean(state.ageMin) ||
    Boolean(state.ageMax) ||
    Boolean(state.registeredFrom) ||
    Boolean(state.registeredTo) ||
    state.balance === "debt";

  // Derive the active tab from the current segment filter.
  const activeTab: PatientsTabKey = state.segment
    ? (SEGMENT_TO_TAB[state.segment as PatientRow["segment"]] ?? "all")
    : "all";

  const handleTabChange = (next: PatientsTabKey) => {
    const segment = TAB_TO_SEGMENT[next];
    setFilter("segment", segment);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageContainer className="flex-1 pb-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-foreground">{t("title")}</h1>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {t("subtitle")}
                {total !== null ? (
                  <>
                    {" · "}
                    <span className="font-semibold text-foreground tabular-nums">
                      {t("count", { count: total })}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ExportButton />
              <Button onClick={() => setDialogOpen(true)}>
                <PlusIcon className="size-4" />
                {t("new")}
              </Button>
            </div>
          </div>

          <PatientsTiles rows={rows} total={total} />

          <PatientsKpiTabs
            rows={rows}
            total={total}
            segmentCounts={segmentCounts}
            totalAcrossSegments={totalAcrossSegments}
            active={activeTab}
            onChange={handleTabChange}
          />

          <PatientsFilters
            state={state}
            onChange={setFilter}
            onClear={clearAll}
          />

          <div className="flex min-h-[60vh] flex-1 flex-col">
            <PatientsTable
              rows={rows}
              isLoading={query.isLoading}
              isFetchingNextPage={query.isFetchingNextPage}
              hasNextPage={Boolean(query.hasNextPage)}
              onLoadMore={() => query.fetchNextPage()}
              hasFilters={hasFilters}
              onCreate={() => setDialogOpen(true)}
              sort={state.sort}
              dir={state.dir}
              onSortChange={(sort, dir) => {
                setFilter("sort", sort);
                setFilter("dir", dir);
              }}
              total={total}
            />
          </div>
        </PageContainer>
      </div>

      <aside
        className="hidden w-[320px] shrink-0 flex-col border-l border-border bg-card p-3 xl:flex"
        aria-label={t("widgets.demographics")}
      >
        <PatientsRightRail rows={rows} />
      </aside>

      <NewPatientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(id) => router.push(`/${locale}/crm/patients/${id}`)}
      />
    </div>
  );
}
