"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { useTranslations, useLocale } from "next-intl";
import { CalendarIcon, DownloadIcon } from "lucide-react";

import { EmptyState } from "@/components/atoms/empty-state";
import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import type {
  AnalyticsResponse,
  CasesAnalyticsResponse,
  FunnelsResponse,
  Period,
} from "./analytics-types";

// Recharts is large (~90KB min+gzip). Keep it out of the base CRM bundle —
// only fetched when the user opens /crm/analytics and the data resolves.
const AnalyticsTopRows = dynamic(
  () => import("./analytics-charts").then((m) => m.AnalyticsTopRows),
  {
    ssr: false,
    loading: () => (
      <>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-56 w-full rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56 w-full rounded-2xl" />
          ))}
        </div>
      </>
    ),
  },
);

const PatientJourneyStrip = dynamic(
  () => import("./cases-section").then((m) => m.PatientJourneyStrip),
  {
    ssr: false,
    loading: () => <Skeleton className="h-40 w-full rounded-2xl" />,
  },
);

const AnalyticsBottomRow = dynamic(
  () => import("./funnel-cards").then((m) => m.AnalyticsBottomRow),
  {
    ssr: false,
    loading: () => (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-56 w-full rounded-2xl" />
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

function fetchCases(period: Period): Promise<CasesAnalyticsResponse> {
  return fetch(`/api/crm/analytics/cases?period=${period}`, {
    credentials: "include",
  }).then((r) => {
    if (!r.ok) throw new Error(`cases ${r.status}`);
    return r.json() as Promise<CasesAnalyticsResponse>;
  });
}

const REASON_KEYS = [
  "patientForgot",
  "noTransport",
  "wrongTime",
  "feltBetter",
  "noConfirm",
  "personalReasons",
  "wrongDoctor",
  "longWait",
  "weather",
  "other",
] as const;

export function AnalyticsPageClient() {
  const t = useTranslations("analyticsDashboard");
  const tFunnels = useTranslations("analytics.funnels");
  const tJourney = useTranslations("analyticsDashboard.journey");
  const tReasons = useTranslations("analyticsDashboard.noShowReasons");
  const tNoShowTable = useTranslations("analyticsDashboard.noShowTable");
  const tSummary = useTranslations("analyticsDashboard.summary");
  const tAxis = useTranslations("analyticsDashboard.axis");
  const locale = useLocale();
  const [period, setPeriod] = React.useState<Period>("week");

  const q = useQuery({
    queryKey: ["analytics", period],
    queryFn: () => fetchAnalytics(period),
    staleTime: 60_000,
  });

  const qFunnels = useQuery({
    queryKey: ["analytics-funnels", period],
    queryFn: () => fetchFunnels(period),
    staleTime: 60_000,
  });

  const qCases = useQuery({
    queryKey: ["analytics-cases", period],
    queryFn: () => fetchCases(period),
    staleTime: 60_000,
  });

  const data = q.data;
  const funnels = qFunnels.data;
  const cases = qCases.data;

  const reasonLabels = React.useMemo(
    () => REASON_KEYS.map((k) => tReasons(k)),
    [tReasons],
  );

  return (
    <PageContainer>
      <SectionHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label={t("openCalendar")}
              className="h-8 w-8"
            >
              <CalendarIcon className="size-4" />
            </Button>
            <PeriodTabs value={period} onChange={setPeriod} />
            <Button
              type="button"
              size="sm"
              variant="default"
              className="h-8 gap-1.5 text-xs"
            >
              <DownloadIcon className="size-3.5" />
              {t("downloadReport")}
            </Button>
          </div>
        }
      />

      {q.isLoading ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-56 w-full rounded-2xl" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-56 w-full rounded-2xl" />
            ))}
          </div>
        </>
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
          <AnalyticsTopRows
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
              apptUnit: tAxis("appointments"),
              avgLtvLabel: tSummary("averageLtv"),
              totalCount: (count) => tSummary("totalCount", { count }),
              totalAll: (count) => tSummary("totalAll", { count }),
              viewAllDoctors: (count) =>
                tSummary("viewAllDoctors", { count }),
              viewAllServices: (count) =>
                tSummary("viewAllServices", { count }),
              deltaPp: (value) => tSummary("deltaPp", { value }),
            }}
          />

          {qCases.isError ? null : !cases ? (
            <Skeleton className="h-40 w-full rounded-2xl" />
          ) : (
            <PatientJourneyStrip
              cases={cases}
              analytics={data}
              locale={locale === "uz" ? "uz" : "ru"}
              labels={{
                sectionTitle: tJourney("title"),
                newPatients: tJourney("newPatients"),
                firstConsult: tJourney("firstConsult"),
                repeatVisits: tJourney("repeatVisits"),
                repeatPct: tJourney("repeatPct"),
                avgCheck: tJourney("avgCheck"),
                revenue: tJourney("revenue"),
                deltaPp: (value) => tSummary("deltaPp", { value }),
              }}
            />
          )}

          {qFunnels.isError ? null : !funnels ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-56 w-full rounded-2xl" />
              ))}
            </div>
          ) : (
            <AnalyticsBottomRow
              funnels={funnels}
              analytics={data}
              locale={locale === "uz" ? "uz" : "ru"}
              labels={{
                tgTitle: tFunnels("tgTitle"),
                callTitle: tFunnels("callTitle"),
                noShowTitle: tFunnels("noShowTitle"),
                waitTimeTitle: tFunnels("waitTimeTitle"),
                clinicLoadTitle: t("sections.clinicLoad"),
                deltaPp: (value) => tSummary("deltaPp", { value }),
                waitColumnDoctor: tFunnels("waitColumnDoctor"),
                waitColumnAvg: tFunnels("waitColumnAvg"),
                waitColumnSamples: tFunnels("waitColumnSamples"),
                seconds: tFunnels("seconds"),
                minutes: tFunnels("minutes"),
                waitTimeEmpty: tFunnels("waitTimeEmpty"),
                noShowReasonHeader: tNoShowTable("reason"),
                noShowCountHeader: tNoShowTable("count"),
                noShowShareHeader: tNoShowTable("share"),
                reasonLabels,
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
