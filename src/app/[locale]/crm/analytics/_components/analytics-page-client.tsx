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

import type { AnalyticsResponse, Period } from "./analytics-types";

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

function fetchAnalytics(period: Period): Promise<AnalyticsResponse> {
  return fetch(`/api/crm/analytics?period=${period}`, {
    credentials: "include",
  }).then((r) => {
    if (!r.ok) throw new Error(`analytics ${r.status}`);
    return r.json() as Promise<AnalyticsResponse>;
  });
}

export function AnalyticsPageClient() {
  const t = useTranslations("analyticsDashboard");
  const locale = useLocale();
  const [period, setPeriod] = React.useState<Period>("month");

  const q = useQuery({
    queryKey: ["analytics", period],
    queryFn: () => fetchAnalytics(period),
    staleTime: 60_000,
  });

  const data = q.data;

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
