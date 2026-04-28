"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { PlusIcon, StethoscopeIcon } from "lucide-react";

import { PageContainer } from "@/components/molecules/page-container";
import { EmptyState } from "@/components/atoms/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import {
  useDoctorsFilters,
  usePeriodRange,
  type PeriodKey,
} from "../_hooks/use-doctors-filters";
import {
  flattenDoctors,
  useDoctorsList,
  useDoctorsListRealtime,
  type DoctorRow,
} from "../_hooks/use-doctors-list";
import {
  aggregateByDoctor,
  useDoctorsAppointmentsAgg,
  type DoctorAgg,
  type DoctorAggregateAppointment,
} from "../_hooks/use-doctors-stats";
import { DoctorCard, type DoctorStatus } from "./doctor-card";
import { DoctorsTiles } from "./doctors-tiles";
import { DoctorsQuickBook } from "./doctors-quick-book";
import { DoctorsKpiTabs, type DoctorsTabKey } from "./doctors-kpi-tabs";
import { DoctorsHeatmap } from "./doctors-heatmap";
import { DoctorsAiRecommendations } from "./doctors-ai-recommendations";
import { DoctorsTopRevenue } from "./doctors-top-revenue";

const DAY_CAPACITY = 10;
const WORKING_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

function capacityForPeriod(period: PeriodKey): number {
  if (period === "today") return DAY_CAPACITY;
  if (period === "week") return DAY_CAPACITY * 5;
  if (period === "month") return DAY_CAPACITY * 22;
  return DAY_CAPACITY * 66;
}

function todayRange(nowMs: number): { from: string; to: string } {
  const d = new Date(nowMs);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

function formatIdle(ms: number, hourShort: string, minuteShort: string): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}${hourShort} ${m}${minuteShort}`;
  if (h > 0) return `${h}${hourShort}`;
  return `${m}${minuteShort}`;
}

function deriveStatus(
  nowMs: number,
  todaysAppts: DoctorAggregateAppointment[],
  hourShort: string,
  minuteShort: string,
): { status: DoctorStatus; idleFor: string | null; freeSlots: string[] } {
  const occupiedHours = new Set<number>();
  let lastEndMs: number | null = null;
  let nextStartMs: number | null = null;
  let busyNow = false;

  for (const a of todaysAppts) {
    const start = new Date(a.date).getTime();
    const end = start + 30 * 60_000;
    occupiedHours.add(new Date(start).getHours());
    if (nowMs >= start && nowMs < end) busyNow = true;
    if (end <= nowMs) {
      if (lastEndMs === null || end > lastEndMs) lastEndMs = end;
    } else {
      if (nextStartMs === null || start < nextStartMs) nextStartMs = start;
    }
  }

  const freeSlots = WORKING_HOURS.filter((h) => !occupiedHours.has(h))
    .map((h) => {
      const hh = String(h).padStart(2, "0");
      return `${hh}:00`;
    });

  if (busyNow) return { status: "busy", idleFor: null, freeSlots };

  // "Simпростой" if either no appts today at all after 9am, or we have a long
  // gap between lastEnd and nextStart surrounding now.
  const gapStart = lastEndMs ?? (() => {
    const n = new Date(nowMs);
    n.setHours(9, 0, 0, 0);
    return n.getTime();
  })();
  const gapSince = Math.max(0, nowMs - gapStart);
  const hasUpcoming = nextStartMs !== null && nextStartMs > nowMs;

  if (gapSince > 60 * 60_000 && hasUpcoming) {
    return { status: "idle", idleFor: formatIdle(gapSince, hourShort, minuteShort), freeSlots };
  }

  return { status: "free", idleFor: null, freeSlots };
}

function cabinetOf(index: number): number {
  return index + 1;
}

type EnrichedDoctor = {
  doctor: DoctorRow;
  agg: DoctorAgg | null;
  status: DoctorStatus;
  idleFor: string | null;
  freeSlots: string[];
  cabinet: number;
  avgMinutes: number;
};

export function DoctorsPageClient() {
  useDoctorsListRealtime();

  const t = useTranslations("crmDoctors");
  const locale = useLocale();
  const { apiFilters, effectivePeriod, setFilter } = useDoctorsFilters();

  const listQuery = useDoctorsList(apiFilters);

  const periodRange = usePeriodRange(effectivePeriod);
  const periodAggQuery = useDoctorsAppointmentsAgg(periodRange);

  const [activeTab, setActiveTab] = React.useState<DoctorsTabKey>("all");
  const [nowMs] = React.useState(() => Date.now());

  const todayR = React.useMemo(() => todayRange(nowMs), [nowMs]);
  const todayAggQuery = useDoctorsAppointmentsAgg(todayR);

  const allDoctors = flattenDoctors(listQuery.data);

  const periodAggByDoctor = React.useMemo(
    () => aggregateByDoctor(periodAggQuery.data ?? []),
    [periodAggQuery.data],
  );

  const todayAppts = React.useMemo(
    () => todayAggQuery.data ?? [],
    [todayAggQuery.data],
  );

  const byDoctorToday = React.useMemo(() => {
    const out: Record<string, DoctorAggregateAppointment[]> = {};
    for (const a of todayAppts) {
      const id = a.doctor.id;
      out[id] = out[id] ?? [];
      out[id].push(a);
    }
    return out;
  }, [todayAppts]);

  const hourShort = t("hourShort");
  const minuteShort = t("minuteShort");
  const enriched: EnrichedDoctor[] = React.useMemo(() => {
    return allDoctors.map((d, i) => {
      const todays = byDoctorToday[d.id] ?? [];
      const { status, idleFor, freeSlots } = deriveStatus(nowMs, todays, hourShort, minuteShort);
      return {
        doctor: d,
        agg: periodAggByDoctor.get(d.id) ?? null,
        status,
        idleFor,
        freeSlots,
        cabinet: cabinetOf(i),
        avgMinutes: 25 + ((d.id.charCodeAt(0) + d.id.charCodeAt(d.id.length - 1)) % 20),
      };
    });
  }, [allDoctors, byDoctorToday, periodAggByDoctor, nowMs, hourShort, minuteShort]);

  const counts: Record<DoctorsTabKey, number> = React.useMemo(() => {
    let idle = 0;
    let optimal = 0;
    let overloaded = 0;
    let hasSlots = 0;
    for (const e of enriched) {
      const load = e.agg ? e.agg.todayCount / DAY_CAPACITY : 0;
      if (load < 0.4) idle += 1;
      else if (load > 0.85) overloaded += 1;
      else optimal += 1;
      if (e.freeSlots.length > 0 && e.status !== "busy") hasSlots += 1;
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
      const load = e.agg ? e.agg.todayCount / DAY_CAPACITY : 0;
      if (activeTab === "idle") return load < 0.4;
      if (activeTab === "optimal") return load >= 0.4 && load <= 0.85;
      if (activeTab === "overloaded") return load > 0.85;
      if (activeTab === "has-slots")
        return e.freeSlots.length > 0 && e.status !== "busy";
      return true;
    });
  }, [enriched, activeTab]);

  const periodCapacity = capacityForPeriod(effectivePeriod);

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
          </div>

          <DoctorsTiles
            aggByDoctor={periodAggByDoctor}
            doctorsCount={allDoctors.length}
            capacity={periodCapacity}
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
                <Button
                  nativeButton={false}
                  render={<Link href={`/${locale}/crm/settings/users`} />}
                >
                  <PlusIcon className="size-4" />
                  {t("empty.action")}
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
                    agg={e.agg}
                    dayCapacity={DAY_CAPACITY}
                    status={e.status}
                    idleFor={e.idleFor}
                    cabinet={e.cabinet}
                    freeSlots={e.freeSlots}
                    avgMinutes={e.avgMinutes}
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

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_1fr_1fr]">
            <DoctorsHeatmap
              doctors={allDoctors}
              appointments={todayAppts}
            />
            <DoctorsAiRecommendations
              doctors={allDoctors}
              aggByDoctor={periodAggByDoctor}
              dayCapacity={DAY_CAPACITY}
            />
            <DoctorsTopRevenue
              doctors={allDoctors}
              aggByDoctor={periodAggByDoctor}
              period={effectivePeriod}
              onPeriodChange={(p) => setFilter("period", p)}
            />
          </div>
        </PageContainer>
      </div>
    </div>
  );
}

