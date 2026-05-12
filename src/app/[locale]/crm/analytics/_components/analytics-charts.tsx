"use client";

/**
 * Top two rows of the analytics dashboard — KPI-overlay chart cards, top
 * doctors / top services horizontal bar lists, sources donut and LTV
 * histogram. Recharts is heavy (~90KB), so the page client `next/dynamic`s
 * this module to keep it out of the base CRM bundle.
 */

import * as React from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
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

import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { useChartColors } from "@/hooks/use-chart-colors";
import { MoneyText } from "@/components/atoms/money-text";
import { CountUp } from "@/components/atoms/count-up";
import { AnimatedPercent } from "@/components/motion/animated-percent";

import type { AnalyticsResponse } from "./analytics-types";

export interface AnalyticsTopRowsProps {
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
    apptUnit: string;
    avgLtvLabel: string;
    totalCount: (count: number) => string;
    totalAll: (count: number) => string;
    viewAllDoctors: (count: number) => string;
    viewAllServices: (count: number) => string;
    deltaPp: (value: string) => string;
  };
}

function pct(n: number): string {
  if (!Number.isFinite(n)) return "0%";
  return `${n.toFixed(1).replace(".", ",")}%`;
}

function pctSigned(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1).replace(".", ",")}%`;
}

function ppSigned(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1).replace(".", ",")}`;
}

function dayLabel(ymd: string): string {
  const parts = ymd.split("-");
  if (parts.length !== 3) return ymd;
  return `${parts[2]}.${parts[1]}`;
}

const APPT_STATUS_TONE: Record<string, string> = {
  COMPLETED: "chart2",
  BOOKED: "chart1",
  IN_PROGRESS: "chart1",
  WAITING: "chart3",
  NO_SHOW: "chart5",
  CANCELLED: "chart5",
  SKIPPED: "chart4",
};

function shortenName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[1]?.[0]?.toUpperCase() ?? ""}.`;
  }
  return name;
}

function pickName<T extends { name: string; nameUz: string | null }>(
  row: T,
  locale: "ru" | "uz",
): string {
  return locale === "uz" && row.nameUz ? row.nameUz : row.name;
}

function KpiCardShell({
  title,
  delta,
  primary,
  secondary,
  body,
  footer,
  height = "h-28",
  className,
}: {
  title: string;
  delta?: React.ReactNode;
  primary?: React.ReactNode;
  secondary?: React.ReactNode;
  body?: React.ReactNode;
  footer?: React.ReactNode;
  height?: string;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-[13px] font-semibold text-foreground">
          {title}
        </h3>
        {delta ? <span className="shrink-0">{delta}</span> : null}
      </div>
      {primary !== undefined || secondary !== undefined ? (
        <div className="mt-1 flex items-baseline gap-2">
          {primary !== undefined ? (
            <span className="text-[20px] font-bold leading-tight text-foreground tabular-nums">
              {primary}
            </span>
          ) : null}
          {secondary !== undefined ? (
            <span className="text-[12px] text-muted-foreground">{secondary}</span>
          ) : null}
        </div>
      ) : null}
      {body ? <div className={cn("mt-3 w-full", height)}>{body}</div> : null}
      {footer ? <div className="mt-3 flex-1">{footer}</div> : null}
    </section>
  );
}

function DeltaChip({
  label,
  positive,
}: {
  label: string;
  positive: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
        positive
          ? "bg-success/15 text-success"
          : "bg-destructive/10 text-destructive",
      )}
    >
      {label}
    </span>
  );
}

function HorizontalBarList({
  rows,
  formatRight,
  ariaLabel,
  highlightFirst,
}: {
  rows: Array<{ id: string; name: string; right: string; bar: number }>;
  formatRight?: (s: string) => React.ReactNode;
  ariaLabel?: string;
  highlightFirst?: boolean;
}) {
  return (
    <ol className="space-y-2.5" aria-label={ariaLabel}>
      {rows.map((r, i) => (
        <li key={r.id} className="flex items-center gap-2 text-[12px]">
          <span
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold",
              highlightFirst && i === 0
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {i + 1}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium text-foreground">
                {r.name}
              </span>
              <span className="shrink-0 tabular-nums font-semibold text-foreground">
                {formatRight ? formatRight(r.right) : r.right}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.max(2, r.bar)}%` }}
              />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function AnalyticsTopRows({
  data,
  locale,
  labels,
}: AnalyticsTopRowsProps) {
  const c = useChartColors();
  const sourcesPalette = React.useMemo(
    () => [c.chart1, c.chart2, c.chart3, c.chart4, c.chart5],
    [c],
  );

  const totalRevenue = React.useMemo(
    () => data.revenueDaily.reduce((a, p) => a + p.amount, 0),
    [data.revenueDaily],
  );

  const revenueDelta = React.useMemo(() => {
    const half = Math.floor(data.revenueDaily.length / 2);
    if (half < 1) return 0;
    let prev = 0;
    let curr = 0;
    for (let i = 0; i < half; i += 1) prev += data.revenueDaily[i]!.amount;
    for (let i = half; i < data.revenueDaily.length; i += 1)
      curr += data.revenueDaily[i]!.amount;
    if (prev === 0) return 0;
    return ((curr - prev) / prev) * 100;
  }, [data.revenueDaily]);

  const totalAppointments = React.useMemo(
    () => data.appointmentsByStatus.reduce((a, s) => a + s.count, 0),
    [data.appointmentsByStatus],
  );

  const noShowAvgRate = React.useMemo(() => {
    if (data.noShowDaily.length === 0) return 0;
    let totalCompleted = 0;
    let totalNoShow = 0;
    for (const d of data.noShowDaily) {
      totalCompleted += d.total;
      totalNoShow += d.noShow;
    }
    if (totalCompleted === 0) return 0;
    return (totalNoShow / totalCompleted) * 100;
  }, [data.noShowDaily]);

  const noShowDelta = React.useMemo(() => {
    const series = data.noShowDaily;
    const half = Math.floor(series.length / 2);
    if (half < 1) return 0;
    const rate = (slice: typeof series) => {
      let t = 0;
      let n = 0;
      for (const p of slice) {
        t += p.total;
        n += p.noShow;
      }
      return t > 0 ? (n / t) * 100 : 0;
    };
    return rate(series.slice(half)) - rate(series.slice(0, half));
  }, [data.noShowDaily]);

  const sourcesTotal = React.useMemo(
    () => data.sources.reduce((a, s) => a + s.count, 0),
    [data.sources],
  );

  const ltvAverage = React.useMemo(() => {
    if (data.ltvBuckets.length === 0) return 0;
    const midpoints: Record<string, number> = {
      "0-300k": 150_000_00,
      "300k-600k": 450_000_00,
      "600k-1M": 800_000_00,
      "1M-2M": 1_500_000_00,
      "2M-3M": 2_500_000_00,
      "3M+": 3_500_000_00,
    };
    let sum = 0;
    let count = 0;
    for (const b of data.ltvBuckets) {
      const mid = midpoints[b.bucket] ?? 1_500_000_00;
      sum += mid * b.count;
      count += b.count;
    }
    return count > 0 ? sum / count : 0;
  }, [data.ltvBuckets]);

  const topDoctorRows = React.useMemo(() => {
    const max = Math.max(1, ...data.topDoctors.map((d) => d.revenue));
    return data.topDoctors.slice(0, 5).map((d) => ({
      id: d.doctorId,
      name: shortenName(pickName(d, locale)),
      right: formatMoney(d.revenue, "UZS", locale),
      bar: (d.revenue / max) * 100,
    }));
  }, [data.topDoctors, locale]);

  const topServiceRows = React.useMemo(() => {
    const max = Math.max(1, ...data.topServices.map((s) => s.count));
    return data.topServices.slice(0, 5).map((s) => ({
      id: s.serviceId,
      name: pickName(s, locale),
      right: `${s.count} ${labels.apptUnit}`,
      bar: (s.count / max) * 100,
    }));
  }, [data.topServices, locale, labels.apptUnit]);

  const apptBars = React.useMemo(
    () =>
      data.appointmentsByStatus.map((s) => ({
        status: s.status,
        count: s.count,
        fill:
          c[(APPT_STATUS_TONE[s.status] ?? "chart1") as keyof typeof c] ??
          c.chart1,
      })),
    [data.appointmentsByStatus, c],
  );

  return (
    <>
      {/* Row 1 — 4 cards: revenue, appointments, no-show, top doctors */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCardShell
          title={labels.revenue}
          delta={
            <DeltaChip
              label={pctSigned(revenueDelta)}
              positive={revenueDelta >= 0}
            />
          }
          primary={
            <MoneyText
              amount={totalRevenue}
              currency="UZS"
              className="text-[20px] font-bold tabular-nums"
            />
          }
          body={
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data.revenueDaily}
                margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
              >
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  formatter={(v) => formatMoney(Number(v), "UZS", locale)}
                  labelFormatter={(l) => dayLabel(String(l))}
                  cursor={false}
                />
                <Line
                  type="monotone"
                  dataKey="amount"
                  stroke={c.chart1}
                  strokeWidth={2}
                  dot={false}
                  animationDuration={800}
                />
              </LineChart>
            </ResponsiveContainer>
          }
        />

        <KpiCardShell
          title={labels.appointments}
          primary={<CountUp to={totalAppointments} />}
          secondary={labels.totalCount(totalAppointments).split(" ").slice(1).join(" ") || undefined}
          body={
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={apptBars}
                margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
              >
                <XAxis
                  dataKey="status"
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                  stroke={c.mutedForeground}
                  tick={{ fill: c.mutedForeground }}
                  tickFormatter={(v: string) =>
                    String(v).slice(0, 4).toLowerCase()
                  }
                />
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  cursor={{ fill: "transparent" }}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {apptBars.map((b, i) => (
                    <Cell key={i} fill={b.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          }
        />

        <KpiCardShell
          title={labels.noShow}
          delta={
            <DeltaChip
              label={labels.deltaPp(ppSigned(noShowDelta))}
              positive={noShowDelta <= 0}
            />
          }
          primary={<AnimatedPercent value={noShowAvgRate} decimals={1} fromHundred />}
          body={
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data.noShowDaily}
                margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
              >
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`}
                  labelFormatter={(l) => dayLabel(String(l))}
                  cursor={false}
                />
                <Line
                  type="monotone"
                  dataKey="rate"
                  stroke={c.warning}
                  strokeWidth={2}
                  dot={false}
                  animationDuration={800}
                />
              </LineChart>
            </ResponsiveContainer>
          }
        />

        <KpiCardShell
          title={labels.topDoctors}
          height="h-auto"
          body={
            topDoctorRows.length === 0 ? (
              <div className="text-[12px] text-muted-foreground">—</div>
            ) : (
              <HorizontalBarList rows={topDoctorRows} highlightFirst />
            )
          }
          footer={
            <Link
              href={`/${locale}/crm/doctors`}
              className="motion-press inline-flex w-full items-center justify-center rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              {labels.viewAllDoctors(data.topDoctors.length)}
            </Link>
          }
        />
      </div>

      {/* Row 2 — 3 cards: top services, sources donut, LTV histogram */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <KpiCardShell
          title={labels.topServices}
          height="h-auto"
          body={
            topServiceRows.length === 0 ? (
              <div className="text-[12px] text-muted-foreground">—</div>
            ) : (
              <HorizontalBarList rows={topServiceRows} highlightFirst />
            )
          }
          footer={
            <Link
              href={`/${locale}/crm/settings/services`}
              className="motion-press inline-flex w-full items-center justify-center rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              {labels.viewAllServices(data.topServices.length)}
            </Link>
          }
        />

        <KpiCardShell
          title={labels.sources}
          height="h-44"
          body={
            <div className="flex h-full items-center gap-3">
              <div className="relative h-full w-28 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.sources}
                      dataKey="count"
                      nameKey="source"
                      innerRadius={32}
                      outerRadius={50}
                      paddingAngle={2}
                      animationDuration={800}
                    >
                      {data.sources.map((_, i) => (
                        <Cell
                          key={i}
                          fill={sourcesPalette[i % sourcesPalette.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[11px] text-muted-foreground">
                    {labels.totalAll(sourcesTotal).split(" ")[0]}
                  </span>
                  <span className="text-[15px] font-bold tabular-nums text-foreground">
                    {sourcesTotal}
                  </span>
                </div>
              </div>
              <ul className="flex min-w-0 flex-1 flex-col gap-1.5 overflow-hidden text-[11px]">
                {data.sources.slice(0, 6).map((s, i) => {
                  const share =
                    sourcesTotal > 0
                      ? Math.round((s.count / sourcesTotal) * 1000) / 10
                      : 0;
                  return (
                    <li
                      key={s.source}
                      className="flex items-center gap-2 leading-tight"
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            sourcesPalette[i % sourcesPalette.length],
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {s.source}
                      </span>
                      <span className="shrink-0 tabular-nums font-semibold text-foreground">
                        {s.count}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {pct(share)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          }
        />

        <KpiCardShell
          title={labels.ltv}
          primary={
            <MoneyText
              amount={ltvAverage}
              currency="UZS"
              className="text-[18px] font-bold tabular-nums"
            />
          }
          secondary={labels.avgLtvLabel}
          height="h-28"
          body={
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.ltvBuckets}
                margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
              >
                <XAxis
                  dataKey="bucket"
                  tickLine={false}
                  axisLine={false}
                  fontSize={9}
                  stroke={c.mutedForeground}
                  tick={{ fill: c.mutedForeground }}
                />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  cursor={{ fill: "transparent" }}
                />
                <Bar dataKey="count" fill={c.chart4} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          }
        />
      </div>
    </>
  );
}
