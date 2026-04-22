"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { StethoscopeIcon } from "lucide-react";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { EmptyState } from "@/components/atoms/empty-state";
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
  aggregateByDoctor,
  useDoctorsAppointmentsAgg,
} from "../_hooks/use-doctors-stats";
import { DoctorCard } from "./doctor-card";
import { DoctorsFilters } from "./doctors-filters";
import { DoctorsRightRail } from "./doctors-right-rail";

function parseRating(r: DoctorRow["rating"]): number {
  if (r === null || r === undefined) return 0;
  const n = typeof r === "string" ? Number(r) : Number(r);
  return Number.isFinite(n) ? n : 0;
}

function nameOf(d: DoctorRow, locale: string): string {
  return locale === "uz" ? d.nameUz : d.nameRu;
}

function capacityForPeriod(period: "today" | "week" | "month" | "quarter"): number {
  if (period === "today") return 10;
  if (period === "week") return 40;
  if (period === "month") return 160;
  return 480;
}

export function DoctorsPageClient() {
  useDoctorsListRealtime();

  const t = useTranslations("crmDoctors");
  const locale = useLocale();
  const {
    state,
    apiFilters,
    effectivePeriod,
    effectiveSort,
    setFilter,
    clearAll,
  } = useDoctorsFilters();

  const listQuery = useDoctorsList(apiFilters);
  const range = usePeriodRange(effectivePeriod);
  const aggQuery = useDoctorsAppointmentsAgg(range);

  const allDoctors = flattenDoctors(listQuery.data);

  const aggByDoctor = React.useMemo(() => {
    return aggregateByDoctor(aggQuery.data ?? []);
  }, [aggQuery.data]);

  // Specializations from the loaded list (client-side — good enough for Phase 2d;
  // if clinic has >100 doctors we'd lift this to a server aggregation TODO).
  const specializations = React.useMemo(() => {
    const set = new Set<string>();
    for (const d of allDoctors) {
      const spec = locale === "uz" ? d.specializationUz : d.specializationRu;
      if (spec) set.add(spec);
    }
    return Array.from(set).sort();
  }, [allDoctors, locale]);

  const sortedDoctors = React.useMemo(() => {
    const arr = [...allDoctors];
    arr.sort((a, b) => {
      if (effectiveSort === "rating") {
        return parseRating(b.rating) - parseRating(a.rating);
      }
      if (effectiveSort === "load") {
        const ta = aggByDoctor.get(a.id)?.total ?? 0;
        const tb = aggByDoctor.get(b.id)?.total ?? 0;
        return tb - ta;
      }
      if (effectiveSort === "revenue") {
        const ra = aggByDoctor.get(a.id)?.revenue ?? 0;
        const rb = aggByDoctor.get(b.id)?.revenue ?? 0;
        return rb - ra;
      }
      return nameOf(a, locale).localeCompare(nameOf(b, locale));
    });
    return arr;
  }, [allDoctors, aggByDoctor, effectiveSort, locale]);

  const hasFilters =
    Boolean(state.q) ||
    Boolean(state.specialization) ||
    state.onlyActive === true;

  const capacity = capacityForPeriod(effectivePeriod);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageContainer className="flex-1 pb-0">
          <SectionHeader
            title={t("title")}
            subtitle={t("subtitle")}
            meta={
              listQuery.data ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {t("count", { count: sortedDoctors.length })}
                </span>
              ) : null
            }
          />

          <DoctorsFilters
            state={state}
            specializations={specializations}
            onChange={setFilter}
            onClear={clearAll}
          />

          <div className="flex min-h-[60vh] flex-col gap-3">
            {listQuery.isLoading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
                  >
                    <div className="flex gap-3">
                      <Skeleton className="size-12 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    </div>
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-2 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ))}
              </div>
            ) : sortedDoctors.length === 0 ? (
              <EmptyState
                icon={<StethoscopeIcon />}
                title={hasFilters ? t("empty.filteredTitle") : t("empty.title")}
                description={
                  hasFilters
                    ? t("empty.filteredDescription")
                    : t("empty.description")
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {sortedDoctors.map((d) => (
                  <DoctorCard
                    key={d.id}
                    doctor={d}
                    agg={aggByDoctor.get(d.id) ?? null}
                    period={effectivePeriod}
                    capacity={capacity}
                  />
                ))}
              </div>
            )}
          </div>
        </PageContainer>
      </div>

      <aside
        className="hidden w-[340px] shrink-0 flex-col border-l border-border bg-card p-4 xl:flex"
        aria-label={t("rail.title")}
      >
        <DoctorsRightRail
          doctors={allDoctors}
          aggByDoctor={aggByDoctor}
          period={effectivePeriod}
          onPeriodChange={(p) => setFilter("period", p)}
          isLoading={aggQuery.isLoading}
        />
      </aside>
    </div>
  );
}
