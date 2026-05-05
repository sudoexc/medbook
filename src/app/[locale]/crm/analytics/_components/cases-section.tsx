"use client";

/**
 * MedicalCase analytics — KPI tiles + complaint bar chart + duration histogram.
 *
 * Loaded via `next/dynamic` from analytics-page-client to keep recharts out
 * of the base CRM bundle (same pattern as AnalyticsCharts / FunnelCards).
 */

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMoney } from "@/lib/format";
import { useChartColors } from "@/hooks/use-chart-colors";
import { KpiTile } from "@/components/atoms/kpi-tile";
import {
  ClipboardListIcon,
  RotateCwIcon,
  Clock3Icon,
  WalletIcon,
} from "lucide-react";

import type { CasesAnalyticsResponse } from "./analytics-types";

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      <div className="h-64 w-full">{children}</div>
    </section>
  );
}

export interface CasesSectionProps {
  data: CasesAnalyticsResponse;
  locale: "ru" | "uz";
  labels: {
    sectionTitle: string;
    kpiOpen: string;
    kpiRepeat: string;
    kpiDuration: string;
    kpiAvgRevenue: string;
    pct: (value: number) => string;
    days: (value: number) => string;
    topComplaintsTitle: string;
    durationTitle: string;
    durationBucketLabel: (b: "1-7" | "8-14" | "15-30" | ">30") => string;
    complaintsEmpty: string;
  };
}

export function CasesSection({ data, locale, labels }: CasesSectionProps) {
  const c = useChartColors();
  const axisProps = {
    fontSize: 11,
    stroke: c.mutedForeground,
    tick: { fill: c.mutedForeground },
  } as const;

  const money = React.useCallback(
    (n: number) => formatMoney(n, "UZS", locale),
    [locale],
  );

  const bucketData = data.durationBuckets.map((b) => ({
    label: labels.durationBucketLabel(b.bucket),
    count: b.count,
  }));

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-base font-semibold text-foreground">
        {labels.sectionTitle}
      </h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label={labels.kpiOpen}
          tone="primary"
          icon={<ClipboardListIcon className="size-4" />}
          value={data.kpis.openCasesTotal}
        />
        <KpiTile
          label={labels.kpiRepeat}
          tone="info"
          icon={<RotateCwIcon className="size-4" />}
          value={labels.pct(data.kpis.repeatConvPct)}
        />
        <KpiTile
          label={labels.kpiDuration}
          tone="neutral"
          icon={<Clock3Icon className="size-4" />}
          value={labels.days(data.kpis.avgDurationDays)}
        />
        <KpiTile
          label={labels.kpiAvgRevenue}
          tone="success"
          icon={<WalletIcon className="size-4" />}
          value={money(data.kpis.avgRevenuePerCase)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title={labels.topComplaintsTitle}>
          {data.topComplaints.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {labels.complaintsEmpty}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.topComplaints}
                layout="vertical"
                margin={{ left: 24 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={c.border} />
                <XAxis type="number" {...axisProps} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="complaint"
                  width={140}
                  {...axisProps}
                />
                <Tooltip />
                <Bar dataKey="count" fill={c.chart2} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title={labels.durationTitle}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bucketData}>
              <CartesianGrid strokeDasharray="3 3" stroke={c.border} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill={c.chart3} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
