"use client";

/**
 * Recharts-heavy view split out so we can `next/dynamic` it from the
 * analytics page client. This keeps recharts out of the initial CRM
 * bundle — it only loads when the user actually navigates to
 * /[locale]/crm/analytics and receives data.
 */

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMoney } from "@/lib/format";
import { useChartColors } from "@/hooks/use-chart-colors";

import type { AnalyticsResponse } from "./analytics-types";

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

export interface AnalyticsChartsProps {
  data: AnalyticsResponse;
  locale: "ru" | "uz";
  labels: {
    revenue: string;
    appointments: string;
    noShow: string;
    topDoctors: string;
    topServices: string;
    sources: string;
    ltv: string;
  };
}

export function AnalyticsCharts({ data, locale, labels }: AnalyticsChartsProps) {
  const c = useChartColors();
  const palette = React.useMemo(
    () => [c.chart1, c.chart2, c.chart3, c.chart4, c.chart5],
    [c],
  );

  const dayLabel = React.useCallback((ymd: string) => {
    const parts = ymd.split("-");
    if (parts.length !== 3) return ymd;
    return `${parts[2]}.${parts[1]}`;
  }, []);

  const money = React.useCallback(
    (n: number) => formatMoney(n, "UZS", locale),
    [locale],
  );

  const axisProps = {
    fontSize: 11,
    stroke: c.mutedForeground,
    tick: { fill: c.mutedForeground },
  } as const;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Revenue daily */}
      <ChartCard title={labels.revenue}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.revenueDaily}>
            <CartesianGrid strokeDasharray="3 3" stroke={c.border} />
            <XAxis dataKey="date" tickFormatter={dayLabel} {...axisProps} />
            <YAxis
              {...axisProps}
              tickFormatter={(v: number) =>
                v >= 1_000_000_00
                  ? `${Math.round(v / 1_000_000_00)}M`
                  : v >= 1_000_00
                    ? `${Math.round(v / 1_000_00)}k`
                    : String(v)
              }
            />
            <Tooltip
              formatter={(value) => money(Number(value))}
              labelFormatter={(label) => dayLabel(String(label))}
            />
            <Line
              type="monotone"
              dataKey="amount"
              stroke={c.chart1}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Appointments by status */}
      <ChartCard title={labels.appointments}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.appointmentsByStatus}>
            <CartesianGrid strokeDasharray="3 3" stroke={c.border} />
            <XAxis dataKey="status" {...axisProps} />
            <YAxis {...axisProps} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill={c.chart1} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* No-show daily */}
      <ChartCard title={labels.noShow}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.noShowDaily}>
            <CartesianGrid strokeDasharray="3 3" stroke={c.border} />
            <XAxis dataKey="date" tickFormatter={dayLabel} {...axisProps} />
            <YAxis
              {...axisProps}
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              domain={[0, 1]}
            />
            <Tooltip
              labelFormatter={(label) => dayLabel(String(label))}
              formatter={(value) => `${(Number(value) * 100).toFixed(1)}%`}
            />
            <Line
              type="monotone"
              dataKey="rate"
              stroke={c.warning}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Top doctors */}
      <ChartCard title={labels.topDoctors}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data.topDoctors}
            layout="vertical"
            margin={{ left: 40 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={c.border} />
            <XAxis
              type="number"
              {...axisProps}
              tickFormatter={(v: number) =>
                v >= 1_000_000_00
                  ? `${Math.round(v / 1_000_000_00)}M`
                  : `${Math.round(v / 1_000_00)}k`
              }
            />
            <YAxis
              type="category"
              dataKey="name"
              {...axisProps}
              width={120}
            />
            <Tooltip formatter={(v) => money(Number(v))} />
            <Bar dataKey="revenue" fill={c.chart1} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Top services */}
      <ChartCard title={labels.topServices}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data.topServices}
            layout="vertical"
            margin={{ left: 40 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={c.border} />
            <XAxis type="number" {...axisProps} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="name"
              {...axisProps}
              width={120}
            />
            <Tooltip />
            <Bar dataKey="count" fill={c.chart4} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Sources pie */}
      <ChartCard title={labels.sources}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data.sources}
              dataKey="count"
              nameKey="source"
              innerRadius={40}
              outerRadius={80}
              paddingAngle={2}
            >
              {data.sources.map((_, i) => (
                <Cell key={i} fill={palette[i % palette.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* LTV histogram */}
      <ChartCard title={labels.ltv}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.ltvBuckets}>
            <CartesianGrid strokeDasharray="3 3" stroke={c.border} />
            <XAxis dataKey="bucket" {...axisProps} />
            <YAxis {...axisProps} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill={c.chart3} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
