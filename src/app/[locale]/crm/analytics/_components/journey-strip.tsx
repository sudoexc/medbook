"use client";

/**
 * Row 3 — «Путь пациента» — full-width strip of 6 KPI cards.
 *
 * Every number comes counted from /api/crm/analytics/journey (definitions
 * in src/server/analytics/patient-journey.ts); revenue is the same PAID
 * sum the revenue chart above shows. The strip used to invent its figures
 * here in the browser (completed = total × 0.62, new patients = first
 * consultations × 0.76 or every open case ever, repeat visits from the
 * share of multi-visit cases), so a week with five new patients read 38
 * (audit AN-15). Nothing is derived here any more beyond formatting.
 *
 * While the clinic does not record payments in the CRM the money cards say
 * so instead of showing the few payments someone happened to enter.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { intlLocale } from "@/lib/format";
import { MoneyText } from "@/components/atoms/money-text";

import type { AnalyticsResponse, JourneyAnalyticsResponse } from "./analytics-types";

export interface PatientJourneyStripProps {
  journey: JourneyAnalyticsResponse;
  analytics: AnalyticsResponse;
  locale: "ru" | "uz";
  labels: {
    sectionTitle: string;
    newPatients: string;
    visits: string;
    repeatVisits: string;
    repeatPct: string;
    avgCheck: string;
    revenue: string;
    noPayments: string;
    noPaidVisits: string;
    hint: string;
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

/** A card value that is not a number: smaller and muted, never «0». */
function Missing({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[13px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

export function PatientJourneyStrip({
  journey: data,
  analytics,
  locale,
  labels,
}: PatientJourneyStripProps) {
  const tag = intlLocale(locale);
  const j = data.journey;

  const totalRevenue = React.useMemo(
    () => analytics.revenueDaily.reduce((a, p) => a + p.amount, 0),
    [analytics.revenueDaily],
  );

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
      <h2 className="text-[14px] font-semibold text-foreground">
        {labels.sectionTitle}
      </h2>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StripCard
          label={labels.newPatients}
          value={j.newPatients.toLocaleString(tag)}
        />
        <StripCard label={labels.visits} value={j.visits.toLocaleString(tag)} />
        <StripCard
          label={labels.repeatVisits}
          value={j.repeatVisits.toLocaleString(tag)}
        />
        <StripCard label={labels.repeatPct} value={pct(j.repeatPct)} />
        <StripCard
          label={labels.avgCheck}
          value={
            !j.paymentsTracked ? (
              <Missing>{labels.noPayments}</Missing>
            ) : j.avgCheck === null ? (
              <Missing>{labels.noPaidVisits}</Missing>
            ) : (
              <MoneyText
                amount={j.avgCheck}
                currency="UZS"
                className="text-[18px] font-bold tabular-nums"
              />
            )
          }
        />
        <StripCard
          label={labels.revenue}
          value={
            !j.paymentsTracked ? (
              <Missing>{labels.noPayments}</Missing>
            ) : (
              <MoneyText
                amount={totalRevenue}
                currency="UZS"
                className="text-[18px] font-bold tabular-nums"
              />
            )
          }
        />
      </div>

      <p className="text-[11px] text-muted-foreground">{labels.hint}</p>
    </section>
  );
}
