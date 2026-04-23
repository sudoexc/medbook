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

import type { AnalyticsResponse } from "./analytics-types";

const TEAL = "#3DD5C0";
const PALETTE = [
  "#3DD5C0",
  "#6366f1",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#0ea5e9",
];

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
  const dayLabel = React.useCallback((ymd: string) => {
    const parts = ymd.split("-");
    if (parts.length !== 3) return ymd;
    return `${parts[2]}.${parts[1]}`;
  }, []);

  const money = React.useCallback(
    (n: number) => formatMoney(n, "UZS", locale),
    [locale],
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Revenue daily */}
      <ChartCard title={labels.revenue}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.revenueDaily}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="date"
              tickFormatter={dayLabel}
              fontSize={11}
              stroke="#94a3b8"
            />
            <YAxis
              fontSize={11}
              stroke="#94a3b8"
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
              stroke={TEAL}
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
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="status" fontSize={11} stroke="#94a3b8" />
            <YAxis fontSize={11} stroke="#94a3b8" allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill={TEAL} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* No-show daily */}
      <ChartCard title={labels.noShow}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.noShowDaily}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="date"
              tickFormatter={dayLabel}
              fontSize={11}
              stroke="#94a3b8"
            />
            <YAxis
              fontSize={11}
              stroke="#94a3b8"
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
              stroke="#ef4444"
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
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              type="number"
              fontSize={11}
              stroke="#94a3b8"
              tickFormatter={(v: number) =>
                v >= 1_000_000_00
                  ? `${Math.round(v / 1_000_000_00)}M`
                  : `${Math.round(v / 1_000_00)}k`
              }
            />
            <YAxis
              type="category"
              dataKey="name"
              fontSize={11}
              stroke="#94a3b8"
              width={120}
            />
            <Tooltip formatter={(v) => money(Number(v))} />
            <Bar dataKey="revenue" fill={TEAL} />
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
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis type="number" fontSize={11} stroke="#94a3b8" allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="name"
              fontSize={11}
              stroke="#94a3b8"
              width={120}
            />
            <Tooltip />
            <Bar dataKey="count" fill={PALETTE[1]} />
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
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
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
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="bucket" fontSize={11} stroke="#94a3b8" />
            <YAxis fontSize={11} stroke="#94a3b8" allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill={PALETTE[3]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
