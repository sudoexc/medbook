"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { useTranslations, useLocale } from "next-intl";

import { EmptyState } from "@/components/atoms/empty-state";
import { MoneyText } from "@/components/atoms/money-text";
import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import {
  applyWhatIfSliders,
  baselineRevenue,
  ceilingRevenue,
  type ForecastPoint,
  type WhatIfSliders,
} from "@/lib/revenue/forecast";
import { AnalyticsSubnav } from "../../loss/_components/loss-page-client";

const ForecastChart = dynamic(
  () => import("./forecast-chart").then((m) => m.ForecastChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-72 w-full" />,
  },
);

interface ForecastResponse {
  points: ForecastPoint[];
  meta: {
    historicalNoShowRate: number;
    emptySlotUpliftRate: number;
    averageServicePriceUzs: number;
  };
}

function fetchForecast(): Promise<ForecastResponse> {
  return fetch(`/api/crm/analytics/forecast`, { credentials: "include" }).then(
    (r) => {
      if (!r.ok) throw new Error(`forecast ${r.status}`);
      return r.json() as Promise<ForecastResponse>;
    },
  );
}

const DEFAULT_SLIDERS: WhatIfSliders = {
  reduceNoShowPct: 0,
  fillEmptyPct: 0,
  priceUpliftPct: 0,
};

export function ForecastPageClient() {
  const t = useTranslations("revenueForecast");
  const tNav = useTranslations("analyticsNav");
  const locale = useLocale();

  const q = useQuery({
    queryKey: ["analytics-forecast"],
    queryFn: fetchForecast,
    staleTime: 5 * 60_000,
  });

  // Slider state — pure client; no server round-trip on drag.
  const [draftSliders, setDraftSliders] = React.useState<WhatIfSliders>(DEFAULT_SLIDERS);
  // We debounce the chart-feeding `sliders` so a fast drag doesn't stall the
  // chart re-renders. 100ms keeps the UI feeling instant; vitest can still
  // assert pure helpers without React in the loop.
  const [sliders, setSliders] = React.useState<WhatIfSliders>(DEFAULT_SLIDERS);
  React.useEffect(() => {
    const id = window.setTimeout(() => setSliders(draftSliders), 100);
    return () => window.clearTimeout(id);
  }, [draftSliders]);

  const baseline = q.data?.points ?? null;
  const adjusted = React.useMemo(
    () => (baseline ? applyWhatIfSliders(baseline, sliders) : null),
    [baseline, sliders],
  );

  const baselineSum = baseline ? baselineRevenue(baseline) : 0;
  const adjustedSum = adjusted ? baselineRevenue(adjusted) : 0;
  const ceilingSum = adjusted ? ceilingRevenue(adjusted) : 0;
  const delta = adjustedSum - baselineSum;

  return (
    <PageContainer>
      <SectionHeader title={t("title")} subtitle={t("subtitle")} />
      <AnalyticsSubnav
        active="forecast"
        labels={{
          overview: tNav("overview"),
          loss: tNav("loss"),
          forecast: tNav("forecast"),
        }}
      />

      {q.isLoading ? (
        <ForecastSkeleton />
      ) : q.isError ? (
        <EmptyState
          title={t("errorTitle")}
          description={t("errorHint")}
          action={
            <Button size="sm" variant="outline" onClick={() => q.refetch()}>
              {t("errorRetry")}
            </Button>
          }
        />
      ) : !q.data || !baseline || !adjusted ? (
        <EmptyState title={t("empty")} description={t("emptyHint")} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label={t("kpi.baseline")} value={baselineSum} />
            <KpiCard label={t("kpi.adjusted")} value={adjustedSum} />
            <KpiCard
              label={t("kpi.delta")}
              value={delta}
              tone={delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral"}
            />
            <KpiCard label={t("kpi.ceiling")} value={ceilingSum} />
          </div>

          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              {t("chartTitle")}
            </h3>
            <div className="h-72 w-full">
              <ForecastChart
                points={adjusted}
                locale={locale === "uz" ? "uz" : "ru"}
                labels={{
                  low: t("band.low"),
                  baseline: t("band.baseline"),
                  high: t("band.high"),
                }}
              />
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              {t("slidersTitle")}
            </h3>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              <SliderRow
                label={t("slider.reduceNoShow")}
                hint={t("slider.reduceNoShowHint")}
                value={draftSliders.reduceNoShowPct}
                onChange={(v) =>
                  setDraftSliders((s) => ({ ...s, reduceNoShowPct: v }))
                }
                min={0}
                max={50}
                step={1}
                suffix="%"
              />
              <SliderRow
                label={t("slider.fillEmpty")}
                hint={t("slider.fillEmptyHint")}
                value={draftSliders.fillEmptyPct}
                onChange={(v) =>
                  setDraftSliders((s) => ({ ...s, fillEmptyPct: v }))
                }
                min={0}
                max={50}
                step={1}
                suffix="%"
              />
              <SliderRow
                label={t("slider.priceUplift")}
                hint={t("slider.priceUpliftHint")}
                value={draftSliders.priceUpliftPct}
                onChange={(v) =>
                  setDraftSliders((s) => ({ ...s, priceUpliftPct: v }))
                }
                min={0}
                max={30}
                step={1}
                suffix="%"
              />
            </div>
          </section>

          <p className="text-xs text-muted-foreground">
            {t("metaHint", {
              noShowRate: `${Math.round(q.data.meta.historicalNoShowRate * 100)}%`,
              upliftRate: `${Math.round(q.data.meta.emptySlotUpliftRate * 100)}%`,
            })}
          </p>
        </>
      )}
    </PageContainer>
  );
}

function ForecastSkeleton() {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-32 w-full" />
    </>
  );
}

function KpiCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "positive" | "negative";
}) {
  const cls =
    tone === "positive"
      ? "text-success"
      : tone === "negative"
        ? "text-destructive"
        : "text-foreground";
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${cls}`}>
        <MoneyText amount={value} currency="UZS" />
      </div>
    </section>
  );
}

function SliderRow({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {value}
          {suffix ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
