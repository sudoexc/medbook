"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { PlusIcon, StethoscopeIcon } from "lucide-react";

import { PageContainer } from "@/components/molecules/page-container";
import { EmptyState } from "@/components/atoms/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import {
  useDoctorsFilters,
  usePeriodRange,
} from "../_hooks/use-doctors-filters";
import {
  flattenDoctors,
  useDoctorsList,
  useDoctorsListRealtime,
  type DoctorRow,
} from "../_hooks/use-doctors-list";
import {
  toAggMap,
  useDoctorsStats,
  useDoctorsToday,
  type DoctorAgg,
  type DoctorToday,
} from "../_hooks/use-doctors-stats";
import { DoctorCard } from "./doctor-card";
import { DoctorsTiles } from "./doctors-tiles";
import { DoctorsQuickBook } from "./doctors-quick-book";
import { DoctorsKpiTabs, type DoctorsTabKey } from "./doctors-kpi-tabs";
import { DoctorsHeatmap } from "./doctors-heatmap";
import { DoctorsAiRecommendations } from "./doctors-ai-recommendations";
import { DoctorsTopRevenue } from "./doctors-top-revenue";
import { DoctorsStatsPanel } from "./doctors-stats-panel";
import { NewDoctorDialog } from "./new-doctor-dialog";

type EnrichedDoctor = {
  doctor: DoctorRow;
  agg: DoctorAgg | null;
  /** Null for a deactivated doctor: nothing is computed for him today. */
  today: DoctorToday | null;
  cabinet: string;
};

/**
 * The load band a doctor's day falls in, from the schedule (DR-08). Null
 * when he has no working time today: no band is honest then, so he is in
 * none of the «Простаивают / Оптимально / Перегружены» tabs.
 */
function loadBand(
  today: DoctorToday | null,
): "idle" | "optimal" | "overloaded" | null {
  const pct = today?.loadPct;
  if (pct === null || pct === undefined) return null;
  if (pct < 40) return "idle";
  if (pct > 85) return "overloaded";
  return "optimal";
}

export function DoctorsPageClient() {
  useDoctorsListRealtime();

  const t = useTranslations("crmDoctors");
  const tCommon = useTranslations("common");
  const { apiFilters, effectivePeriod, setFilter } = useDoctorsFilters();

  const listQuery = useDoctorsList(apiFilters);

  const periodRange = usePeriodRange(effectivePeriod);
  const periodAggQuery = useDoctorsStats(periodRange);

  const [activeTab, setActiveTab] = React.useState<DoctorsTabKey>("all");
  const [newDoctorOpen, setNewDoctorOpen] = React.useState(false);

  // Today's working time, load, live status, next free slot and hour
  // heatmap, from the schedule and the real visits (DR-08).
  const todayQuery = useDoctorsToday();

  const allDoctors = flattenDoctors(listQuery.data);

  const periodAggByDoctor = React.useMemo(
    () => toAggMap(periodAggQuery.data ?? []),
    [periodAggQuery.data],
  );
  // A failed load must read as a failure, not as a quiet clinic: the page
  // used to turn a 400 into zero revenue and 0 % load (DR-01).
  const statsFailed = periodAggQuery.isError || todayQuery.isError;
  const retryStats = () => {
    if (periodAggQuery.isError) void periodAggQuery.refetch();
    if (todayQuery.isError) void todayQuery.refetch();
  };

  const todayByDoctor = React.useMemo(() => {
    const m = new Map<string, DoctorToday>();
    for (const r of todayQuery.data?.doctors ?? []) m.set(r.doctorId, r);
    return m;
  }, [todayQuery.data]);

  const enriched: EnrichedDoctor[] = React.useMemo(() => {
    return allDoctors.map((d) => ({
      doctor: d,
      agg: periodAggByDoctor.get(d.id) ?? null,
      today: todayByDoctor.get(d.id) ?? null,
      cabinet: d.cabinet?.number ?? "—",
    }));
  }, [allDoctors, periodAggByDoctor, todayByDoctor]);

  const counts: Record<DoctorsTabKey, number> = React.useMemo(() => {
    let idle = 0;
    let optimal = 0;
    let overloaded = 0;
    let hasSlots = 0;
    for (const e of enriched) {
      const band = loadBand(e.today);
      if (band === "idle") idle += 1;
      else if (band === "optimal") optimal += 1;
      else if (band === "overloaded") overloaded += 1;
      if (e.today?.nextFree) hasSlots += 1;
    }
    return {
      all: enriched.length,
      idle,
      optimal,
      overloaded,
      "has-slots": hasSlots,
    };
  }, [enriched]);

  const filteredEnriched = React.useMemo(() => {
    if (activeTab === "all") return enriched;
    return enriched.filter((e) => {
      if (activeTab === "has-slots") return Boolean(e.today?.nextFree);
      return loadBand(e.today) === activeTab;
    });
  }, [enriched, activeTab]);

  const loadByDoctor = React.useMemo(() => {
    const m = new Map<string, number | null>();
    for (const [id, r] of todayByDoctor) m.set(id, r.loadPct);
    return m;
  }, [todayByDoctor]);

  const liveStatuses = React.useMemo(
    () =>
      enriched
        .filter((e) => e.doctor.isActive)
        .map((e) => e.today?.status ?? "off"),
    [enriched],
  );

  const isEmpty = !listQuery.isLoading && allDoctors.length === 0;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageContainer className="flex-1 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-foreground">{t("title")}</h1>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {t("subtitle")}
                {allDoctors.length > 0 ? (
                  <>
                    {" · "}
                    <span className="font-semibold text-foreground tabular-nums">
                      {t("count", { count: allDoctors.length })}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
            <Button onClick={() => setNewDoctorOpen(true)}>
              <PlusIcon className="size-4" />
              {t("new")}
            </Button>
          </div>

          {statsFailed ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-[13px] text-destructive"
            >
              <span>{t("statsError")}</span>
              <Button size="sm" variant="outline" onClick={retryStats}>
                {tCommon("retry")}
              </Button>
            </div>
          ) : null}

          <DoctorsTiles
            aggByDoctor={periodAggByDoctor}
            today={todayQuery.data?.clinic ?? null}
            unavailable={periodAggQuery.isError}
            todayUnavailable={todayQuery.isError}
          />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <DoctorsQuickBook doctors={allDoctors} />
            <DoctorsKpiTabs
              counts={counts}
              active={activeTab}
              onChange={setActiveTab}
            />
          </div>

          {listQuery.isLoading ? (
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex h-[320px] flex-col gap-3 rounded-2xl border border-border bg-card p-3"
                >
                  <div className="flex gap-2">
                    <Skeleton className="size-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                  <Skeleton className="h-2 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="mt-auto h-8 w-full" />
                </div>
              ))}
            </div>
          ) : isEmpty ? (
            <EmptyState
              icon={<StethoscopeIcon />}
              title={t("empty.title")}
              description={t("empty.description")}
              action={
                <Button onClick={() => setNewDoctorOpen(true)}>
                  <PlusIcon className="size-4" />
                  {t("new")}
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto pb-1">
              <div className="flex gap-3">
                {filteredEnriched.map((e) => (
                  <DoctorCard
                    key={e.doctor.id}
                    doctor={e.doctor}
                    today={e.today}
                    todayLoading={todayQuery.isLoading}
                    cabinet={e.cabinet}
                  />
                ))}
                {filteredEnriched.length === 0 ? (
                  <div className="w-full py-8 text-center text-[12px] text-muted-foreground">
                    {t("empty.filteredTitle")}
                  </div>
                ) : null}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-[1.3fr_1fr_1fr_1fr]">
            <DoctorsHeatmap
              doctors={allDoctors}
              today={todayQuery.data?.doctors ?? []}
            />
            <DoctorsAiRecommendations
              doctors={allDoctors}
              loadByDoctor={loadByDoctor}
            />
            <DoctorsTopRevenue
              doctors={allDoctors}
              aggByDoctor={periodAggByDoctor}
              period={effectivePeriod}
              onPeriodChange={(p) => setFilter("period", p)}
            />
            <DoctorsStatsPanel
              doctors={allDoctors}
              statuses={liveStatuses}
              clinicLoadPct={todayQuery.data?.clinic.loadPct ?? null}
            />
          </div>
        </PageContainer>
      </div>

      <NewDoctorDialog
        open={newDoctorOpen}
        onOpenChange={setNewDoctorOpen}
      />
    </div>
  );
}

