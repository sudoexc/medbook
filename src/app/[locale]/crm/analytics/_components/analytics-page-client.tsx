"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations, useLocale } from "next-intl";
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

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format";

type Period = "week" | "month" | "quarter";

interface AnalyticsResponse {
  period: Period | "custom";
  from: string;
  to: string;
  doctorOnly: boolean;
  revenueDaily: Array<{ date: string; amount: number }>;
  appointmentsByStatus: Array<{ status: string; count: number }>;
  noShowDaily: Array<{ date: string; total: number; noShow: number; rate: number }>;
  topDoctors: Array<{
    doctorId: string;
    name: string;
    nameUz: string | null;
    revenue: number;
    count: number;
  }>;
  topServices: Array<{
    serviceId: string;
    name: string;
    nameUz: string | null;
    count: number;
  }>;
  sources: Array<{ source: string; count: number }>;
  ltvBuckets: Array<{ bucket: string; count: number }>;
}

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

function fetchAnalytics(period: Period): Promise<AnalyticsResponse> {
  return fetch(`/api/crm/analytics?period=${period}`, {
    credentials: "include",
  }).then((r) => {
    if (!r.ok) throw new Error(`analytics ${r.status}`);
    return r.json() as Promise<AnalyticsResponse>;
  });
}

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

  const dayLabel = React.useCallback(
    (ymd: string) => {
      // "2026-04-22" -> "22.04"
      const parts = ymd.split("-");
      if (parts.length !== 3) return ymd;
      return `${parts[2]}.${parts[1]}`;
    },
    [],
  );

  const money = (n: number) =>
    formatMoney(n, "UZS", locale === "uz" ? "uz" : "ru");

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
      ) : !data ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Revenue daily */}
          <ChartCard title={t("sections.revenue")}>
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
          <ChartCard title={t("sections.appointments")}>
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
          <ChartCard title={t("sections.noShow")}>
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
          <ChartCard title={t("sections.topDoctors")}>
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
          <ChartCard title={t("sections.topServices")}>
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
          <ChartCard title={t("sections.sources")}>
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
          <ChartCard title={t("sections.ltv")}>
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
