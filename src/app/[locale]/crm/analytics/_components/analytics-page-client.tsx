"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { useTranslations, useLocale } from "next-intl";

import { EmptyState } from "@/components/atoms/empty-state";
import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import type {
  AnalyticsResponse,
  FunnelsResponse,
  Period,
} from "./analytics-types";

// Recharts is large (~90KB min+gzip). Keep it out of the base CRM bundle —
// only fetched when the user opens /crm/analytics and the data resolves.
const AnalyticsCharts = dynamic(
  () => import("./analytics-charts").then((m) => m.AnalyticsCharts),
  {
    ssr: false,
    loading: () => (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-64 w-full" />
        ))}
      </div>
    ),
  },
);

// Phase 8a — conversion-funnel KPI cards. Pulled in via the same dynamic
// boundary as AnalyticsCharts (also recharts-heavy for sparklines).
const FunnelCards = dynamic(
  () => import("./funnel-cards").then((m) => m.FunnelCards),
  {
    ssr: false,
    loading: () => (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    ),
  },
);

function fetchAnalytics(period: Period): Promise<AnalyticsResponse> {
  return fetch(`/api/crm/analytics?period=${period}`, {
    credentials: "include",
  }).then((r) => {
    if (!r.ok) throw new Error(`analytics ${r.status}`);
    return r.json() as Promise<AnalyticsResponse>;
  });
}

function fetchFunnels(period: Period): Promise<FunnelsResponse> {
  return fetch(`/api/crm/analytics/funnels?period=${period}`, {
    credentials: "include",
  }).then((r) => {
    if (!r.ok) throw new Error(`funnels ${r.status}`);
    return r.json() as Promise<FunnelsResponse>;
  });
}

export function AnalyticsPageClient() {
  const t = useTranslations("analyticsDashboard");
  const tFunnels = useTranslations("analytics.funnels");
  const locale = useLocale();
  const [period, setPeriod] = React.useState<Period>("month");

  const q = useQuery({
    queryKey: ["analytics", period],
    queryFn: () => fetchAnalytics(period),
    staleTime: 60_000,
  });

  // Funnels live behind their own endpoint so the heavier joins don't slow
  // down the main dashboard render. Both queries share the period state.
  const qFunnels = useQuery({
    queryKey: ["analytics-funnels", period],
    queryFn: () => fetchFunnels(period),
    staleTime: 60_000,
  });

  const data = q.data;
  const funnels = qFunnels.data;

  return (
    <PageContainer>
      <SectionHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <div className="flex items-center gap-2">
            <PeriodTabs value={period} onChange={setPeriod} />
          </div>
        }
      />

      {q.isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
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
      ) : !data ? (
        <EmptyState title={t("empty")} description={t("emptyHint")} />
      ) : (
        <>
          <AnalyticsCharts
            data={data}
            locale={locale === "uz" ? "uz" : "ru"}
            labels={{
              revenue: t("sections.revenue"),
              appointments: t("sections.appointments"),
              noShow: t("sections.noShow"),
              topDoctors: t("sections.topDoctors"),
              topServices: t("sections.topServices"),
              sources: t("sections.sources"),
              ltv: t("sections.ltv"),
            }}
          />

          {qFunnels.isError ? null : !funnels ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-40 w-full" />
              ))}
            </div>
          ) : (
            <FunnelCards
              data={funnels}
              locale={locale === "uz" ? "uz" : "ru"}
              labels={{
                tgTitle: tFunnels("tgTitle"),
                callTitle: tFunnels("callTitle"),
                noShowTitle: tFunnels("noShowTitle"),
                waitTimeTitle: tFunnels("waitTimeTitle"),
                rate: tFunnels("rate"),
                converted: tFunnels("converted"),
                of: tFunnels("of"),
                sparkTooltipDate: tFunnels("sparkTooltipDate"),
                sparkTooltipRate: tFunnels("sparkTooltipRate"),
                noShowDoctorsTab: tFunnels("noShowDoctorsTab"),
                noShowServicesTab: tFunnels("noShowServicesTab"),
                noShowEmpty: tFunnels("noShowEmpty"),
                waitTimeEmpty: tFunnels("waitTimeEmpty"),
                waitColumnDoctor: tFunnels("waitColumnDoctor"),
                waitColumnAvg: tFunnels("waitColumnAvg"),
                waitColumnSamples: tFunnels("waitColumnSamples"),
                seconds: tFunnels("seconds"),
                minutes: tFunnels("minutes"),
                pickName: (row) =>
                  locale === "uz" && row.nameUz ? row.nameUz : row.name,
              }}
            />
          )}
        </>
      )}
    </PageContainer>
  );
}

function PeriodTabs({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  const t = useTranslations("analyticsDashboard.period");
  const opts: Period[] = ["week", "month", "quarter"];
  return (
    <div className="inline-flex rounded-md border border-border bg-background p-0.5">
      {opts.map((p) => (
        <Button
          key={p}
          size="sm"
          variant={value === p ? "default" : "ghost"}
          onClick={() => onChange(p)}
          className="h-7 px-3 text-xs"
        >
          {t(p)}
        </Button>
      ))}
    </div>
  );
}
