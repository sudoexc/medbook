"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations, useLocale } from "next-intl";

import { EmptyState } from "@/components/atoms/empty-state";
import { MoneyText } from "@/components/atoms/money-text";
import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { LossDashboardResponse, LossPeriod } from "./loss-types";

const LossChart = dynamic(
  () => import("./loss-chart").then((m) => m.LossChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-72 w-full" />,
  },
);

function fetchLoss(period: LossPeriod): Promise<LossDashboardResponse> {
  return fetch(`/api/crm/analytics/loss?period=${period}`, {
    credentials: "include",
  }).then((r) => {
    if (!r.ok) throw new Error(`loss-analytics ${r.status}`);
    return r.json() as Promise<LossDashboardResponse>;
  });
}

export function LossPageClient() {
  const t = useTranslations("lossAnalytics");
  const tNav = useTranslations("analyticsNav");
  const locale = useLocale();
  const [period, setPeriod] = React.useState<LossPeriod>("month");

  const q = useQuery({
    queryKey: ["analytics-loss", period],
    queryFn: () => fetchLoss(period),
    staleTime: 60_000,
  });

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

      <AnalyticsSubnav active="loss" labels={{ overview: tNav("overview"), loss: tNav("loss"), forecast: tNav("forecast") }} />

      {q.isLoading ? (
        <LossSkeleton />
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
      ) : !q.data ? (
        <EmptyState title={t("empty")} description={t("emptyHint")} />
      ) : (
        <>
          <KpiGrid data={q.data} t={t} />

          {!q.data.hasAnyData ? (
            <EmptyState
              title={t("noSnapshotsTitle")}
              description={t("noSnapshotsHint")}
            />
          ) : (
            <>
              <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">
                  {t("trendTitle")}
                </h3>
                <div className="h-72 w-full">
                  <LossChart
                    daily={q.data.daily}
                    locale={locale === "uz" ? "uz" : "ru"}
                    labels={{
                      emptySlot: t("sources.emptySlot"),
                      noShow: t("sources.noShow"),
                      cancellation: t("sources.cancellation"),
                      dormant: t("sources.dormant"),
                    }}
                  />
                </div>
              </section>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <DoctorsTable
                  rows={q.data.topDoctors}
                  locale={locale}
                  t={t}
                />
                <SegmentsTable
                  rows={q.data.dormantSegments}
                  averageVisitValueUzs={q.data.averageVisitValueUzs}
                  t={t}
                />
              </div>
            </>
          )}
        </>
      )}
    </PageContainer>
  );
}

function LossSkeleton() {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </>
  );
}

function KpiGrid({
  data,
  t,
}: {
  data: LossDashboardResponse;
  t: (key: string) => string;
}) {
  const cards: Array<{ key: string; amount: number; label: string }> = [
    {
      key: "emptySlot",
      amount: data.totals.emptySlot,
      label: t("sources.emptySlot"),
    },
    { key: "noShow", amount: data.totals.noShow, label: t("sources.noShow") },
    {
      key: "cancellation",
      amount: data.totals.cancellation,
      label: t("sources.cancellation"),
    },
    {
      key: "dormant",
      amount: data.totals.dormant,
      label: t("sources.dormant"),
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => (
        <section
          key={c.key}
          className="rounded-lg border border-border bg-card p-4"
        >
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {c.label}
          </div>
          <div className="mt-2 text-2xl font-semibold text-foreground tabular-nums">
            <MoneyText amount={c.amount} currency="UZS" />
          </div>
        </section>
      ))}
      <section className="rounded-lg border border-border bg-card p-4 sm:col-span-2 xl:col-span-4">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("totalLabel")}
        </div>
        <div className="mt-2 text-3xl font-bold text-foreground tabular-nums">
          <MoneyText amount={data.totals.total} currency="UZS" />
        </div>
      </section>
    </div>
  );
}

function DoctorsTable({
  rows,
  locale,
  t,
}: {
  rows: LossDashboardResponse["topDoctors"];
  locale: string;
  t: (key: string) => string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">
        {t("topDoctorsTitle")}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("topDoctorsEmpty")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("col.doctor")}</TableHead>
              <TableHead className="text-right">{t("col.total")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.doctorId}>
                <TableCell className="font-medium">
                  {locale === "uz" ? r.nameUz : r.nameRu}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <MoneyText amount={r.totalUzs} currency="UZS" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function SegmentsTable({
  rows,
  averageVisitValueUzs,
  t,
}: {
  rows: LossDashboardResponse["dormantSegments"];
  averageVisitValueUzs: number;
  t: (key: string) => string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">
        {t("dormantSegmentsTitle")}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("dormantSegmentsEmpty")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("col.segment")}</TableHead>
              <TableHead className="text-right">{t("col.patients")}</TableHead>
              <TableHead className="text-right">{t("col.estimated")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.segment}>
                <TableCell className="font-medium">
                  {t(`segments.${r.segment}`)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.patientCount}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <MoneyText amount={r.estimatedRevenueUzs} currency="UZS" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {t("avgVisitValueHint")}{" "}
        <MoneyText amount={averageVisitValueUzs} currency="UZS" />
      </p>
    </section>
  );
}

function PeriodTabs({
  value,
  onChange,
}: {
  value: LossPeriod;
  onChange: (p: LossPeriod) => void;
}) {
  const t = useTranslations("analyticsDashboard.period");
  const opts: LossPeriod[] = ["week", "month", "quarter"];
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

export function AnalyticsSubnav({
  active,
  labels,
}: {
  active: "overview" | "loss" | "forecast";
  labels: { overview: string; loss: string; forecast: string };
}) {
  const locale = useLocale();
  const tabs: Array<{ key: typeof active; href: string; label: string }> = [
    { key: "overview", href: `/${locale}/crm/analytics`, label: labels.overview },
    { key: "loss", href: `/${locale}/crm/analytics/loss`, label: labels.loss },
    {
      key: "forecast",
      href: `/${locale}/crm/analytics/forecast`,
      label: labels.forecast,
    },
  ];
  return (
    <nav className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-background p-1 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={
            active === tab.key
              ? "rounded px-3 py-1.5 bg-primary text-primary-foreground"
              : "rounded px-3 py-1.5 text-muted-foreground hover:bg-muted"
          }
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
