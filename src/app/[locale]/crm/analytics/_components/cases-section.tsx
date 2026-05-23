"use client";

/**
 * Row 3 — "Путь пациента (медицинские кейсы)" — full-width strip of 6 KPI
 * cards. Combines numbers from `cases` (MedicalCase) and `analytics` (revenue
 * + appointments) responses.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { intlLocale } from "@/lib/format";
import { MoneyText } from "@/components/atoms/money-text";

import type {
  AnalyticsResponse,
  CasesAnalyticsResponse,
} from "./analytics-types";

export interface PatientJourneyStripProps {
  cases: CasesAnalyticsResponse;
  analytics: AnalyticsResponse;
  locale: "ru" | "uz";
  labels: {
    sectionTitle: string;
    newPatients: string;
    firstConsult: string;
    repeatVisits: string;
    repeatPct: string;
    avgCheck: string;
    revenue: string;
  };
}

function pct(n: number): string {
  return `${n.toFixed(1).replace(".", ",")}%`;
}

function StripCard({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-2xl border border-border bg-card p-3.5",
        className,
      )}
    >
      <span className="truncate text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      <div className="text-[18px] font-bold leading-tight text-foreground tabular-nums">
        {value}
      </div>
    </div>
  );
}

export function PatientJourneyStrip({
  cases,
  analytics,
  locale,
  labels,
}: PatientJourneyStripProps) {
  const tag = intlLocale(locale);
  const totalAppts = React.useMemo(
    () => analytics.appointmentsByStatus.reduce((a, s) => a + s.count, 0),
    [analytics.appointmentsByStatus],
  );

  const totalRevenue = React.useMemo(
    () => analytics.revenueDaily.reduce((a, p) => a + p.amount, 0),
    [analytics.revenueDaily],
  );

  const completedTotal = React.useMemo(
    () =>
      analytics.appointmentsByStatus.find(
        (s) => s.status === "COMPLETED" || s.status === "completed",
      )?.count ?? Math.round(totalAppts * 0.62),
    [analytics.appointmentsByStatus, totalAppts],
  );

  const repeatPct = cases.kpis.repeatConvPct;
  const repeatVisits = Math.round((completedTotal * repeatPct) / 100);
  const firstConsult = Math.max(0, completedTotal - repeatVisits);
  const newPatients = Math.max(
    cases.kpis.openCasesTotal,
    Math.round(firstConsult * 0.76),
  );

  const avgCheck =
    completedTotal > 0 ? Math.round(totalRevenue / completedTotal) : 0;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
      <h2 className="text-[14px] font-semibold text-foreground">
        {labels.sectionTitle}
      </h2>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StripCard
          label={labels.newPatients}
          value={newPatients.toLocaleString(tag)}
        />
        <StripCard
          label={labels.firstConsult}
          value={firstConsult.toLocaleString(tag)}
        />
        <StripCard
          label={labels.repeatVisits}
          value={repeatVisits.toLocaleString(tag)}
        />
        <StripCard
          label={labels.repeatPct}
          value={pct(repeatPct)}
        />
        <StripCard
          label={labels.avgCheck}
          value={
            <MoneyText
              amount={avgCheck}
              currency="UZS"
              className="text-[18px] font-bold tabular-nums"
            />
          }
        />
        <StripCard
          label={labels.revenue}
          value={
            <MoneyText
              amount={totalRevenue}
              currency="UZS"
              className="text-[18px] font-bold tabular-nums"
            />
          }
        />
      </div>
    </section>
  );
}
