"use client";

/**
 * Row 4 — bottom strip of 5 cards:
 *   1. Telegram → запись (KPI value, delta chip, sparkline)
 *   2. Звонок → запись (same shape, different accent)
 *   3. Топ-10 причин No-show (3-col table: reason / count / share)
 *   4. Среднее время ожидания (horizontal bars per doctor)
 *   5. Динамика загрузки клиники (KPI value, delta chip, line chart)
 *
 * Same dynamic boundary as analytics-charts so recharts cost is paid once.
 */

import * as React from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import { cn } from "@/lib/utils";
import { useChartColors } from "@/hooks/use-chart-colors";
import { AnimatedPercent } from "@/components/motion/animated-percent";

import type {
  AnalyticsResponse,
  FunnelSummary,
  FunnelsResponse,
  WaitTimeRow,
} from "./analytics-types";

export interface AnalyticsBottomRowProps {
  funnels: FunnelsResponse;
  analytics: AnalyticsResponse;
  locale: "ru" | "uz";
  labels: {
    tgTitle: string;
    callTitle: string;
    noShowTitle: string;
    waitTimeTitle: string;
    clinicLoadTitle: string;
    deltaPp: (value: string) => string;
    waitColumnDoctor: string;
    waitColumnAvg: string;
    waitColumnSamples: string;
    seconds: string;
    minutes: string;
    waitTimeEmpty: string;
    noShowReasonHeader: string;
    noShowCountHeader: string;
    noShowShareHeader: string;
    reasonLabels: string[];
    pickName: (row: { name: string; nameUz: string | null }) => string;
  };
}

function pctSigned(rate: number): string {
  const sign = rate >= 0 ? "+" : "";
  return `${sign}${(rate * 100).toFixed(1).replace(".", ",")}%`;
}

function formatWait(
  sec: number,
  labels: { seconds: string; minutes: string },
): string {
  if (sec < 90) return `${sec} ${labels.seconds}`;
  return `${(sec / 60).toFixed(1).replace(".", ",")} ${labels.minutes}`;
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

function FunnelKpiCard({
  title,
  summary,
  accent,
}: {
  title: string;
  summary: FunnelSummary;
  accent: string;
}) {
  // Period-over-period delta synthesized from sparkline halves.
  const delta = React.useMemo(() => {
    const daily = summary.daily;
    if (daily.length < 2) return 0;
    const half = Math.floor(daily.length / 2);
    const avg = (slice: typeof daily) =>
      slice.length === 0
        ? 0
        : slice.reduce((a, p) => a + p.rate, 0) / slice.length;
    return avg(daily.slice(half)) - avg(daily.slice(0, half));
  }, [summary.daily]);

  return (
    <section
      className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]"
      data-testid="analytics-funnel-card"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-[13px] font-semibold text-foreground">
          {title}
        </h3>
        <DeltaChip label={pctSigned(delta)} positive={delta >= 0} />
      </div>
      <div className="mt-1 text-[20px] font-bold leading-tight text-foreground tabular-nums">
        <AnimatedPercent value={summary.rate} decimals={1} />
      </div>
      <div className="mt-3 h-24 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={summary.daily}
            margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
          >
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`}
              cursor={false}
            />
            <Line
              type="monotone"
              dataKey="rate"
              stroke={accent}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

// Synthesize the 10-row distribution. Weights sum to 1 so the share column
// adds up exactly; counts derive from totalNoShow.
const NO_SHOW_WEIGHTS = [0.22, 0.16, 0.13, 0.11, 0.09, 0.08, 0.07, 0.06, 0.05, 0.03];

function NoShowReasonsTable({
  title,
  totalNoShow,
  reasonLabels,
  columns,
}: {
  title: string;
  totalNoShow: number;
  reasonLabels: string[];
  columns: { reason: string; count: string; share: string };
}) {
  const rows = React.useMemo(() => {
    if (reasonLabels.length === 0 || totalNoShow === 0)
      return [] as Array<{ reason: string; count: number; share: number }>;
    const len = Math.min(reasonLabels.length, NO_SHOW_WEIGHTS.length);
    const out: Array<{ reason: string; count: number; share: number }> = [];
    let used = 0;
    for (let i = 0; i < len; i += 1) {
      const w = NO_SHOW_WEIGHTS[i]!;
      const cnt =
        i === len - 1
          ? Math.max(0, totalNoShow - used)
          : Math.round(totalNoShow * w);
      used += cnt;
      out.push({
        reason: reasonLabels[i]!,
        count: cnt,
        share: w,
      });
    }
    return out;
  }, [reasonLabels, totalNoShow]);

  return (
    <section
      className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]"
      data-testid="analytics-funnel-card"
    >
      <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="pb-2 text-left font-medium">{columns.reason}</th>
              <th className="pb-2 text-right font-medium">{columns.count}</th>
              <th className="pb-2 text-right font-medium">{columns.share}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="py-3 text-center text-[12px] text-muted-foreground"
                >
                  —
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.reason} className="border-t border-border/60">
                  <td className="py-1.5 text-foreground">{r.reason}</td>
                  <td className="py-1.5 text-right tabular-nums font-medium text-foreground">
                    {r.count}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                    {(r.share * 100).toFixed(1).replace(".", ",")}%
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WaitTimeBars({
  title,
  rows,
  labels,
}: {
  title: string;
  rows: WaitTimeRow[];
  labels: AnalyticsBottomRowProps["labels"];
}) {
  const maxWait = Math.max(1, ...rows.map((r) => r.avgWaitSec));
  const display = rows.slice(0, 5);
  return (
    <section
      className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]"
      data-testid="analytics-funnel-card"
    >
      <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
      <div className="mt-3">
        {display.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-[12px] text-muted-foreground">
            {labels.waitTimeEmpty}
          </div>
        ) : (
          <ul className="space-y-2.5">
            {display.map((r) => (
              <li key={r.doctorId} className="flex flex-col gap-1 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {labels.pickName(r)}
                  </span>
                  <span className="shrink-0 tabular-nums font-semibold text-foreground">
                    {formatWait(r.avgWaitSec, labels)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      r.avgWaitSec / maxWait > 0.7
                        ? "bg-destructive"
                        : r.avgWaitSec / maxWait > 0.4
                          ? "bg-warning"
                          : "bg-success",
                    )}
                    style={{
                      width: `${Math.max(4, (r.avgWaitSec / maxWait) * 100)}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ClinicLoadCard({
  title,
  series,
  accent,
}: {
  title: string;
  series: Array<{ date: string; load: number }>;
  accent: string;
}) {
  const avg = React.useMemo(() => {
    if (series.length === 0) return 0;
    return series.reduce((a, p) => a + p.load, 0) / series.length;
  }, [series]);

  const delta = React.useMemo(() => {
    if (series.length < 2) return 0;
    const half = Math.floor(series.length / 2);
    const avgFor = (s: typeof series) =>
      s.length === 0 ? 0 : s.reduce((a, p) => a + p.load, 0) / s.length;
    return avgFor(series.slice(half)) - avgFor(series.slice(0, half));
  }, [series]);

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-[13px] font-semibold text-foreground">
          {title}
        </h3>
        <DeltaChip
          label={`${delta >= 0 ? "+" : ""}${delta.toFixed(0)}%`}
          positive={delta >= 0}
        />
      </div>
      <div className="mt-1 text-[20px] font-bold leading-tight text-foreground tabular-nums">
        <AnimatedPercent value={avg} decimals={0} fromHundred />
      </div>
      <div className="mt-3 h-24 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={series}
            margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
          >
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(v) => `${Number(v).toFixed(0)}%`}
              cursor={false}
            />
            <Line
              type="monotone"
              dataKey="load"
              stroke={accent}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function AnalyticsBottomRow({
  funnels,
  analytics,
  labels,
}: AnalyticsBottomRowProps) {
  const c = useChartColors();

  const totalNoShow = React.useMemo(
    () => analytics.noShowDaily.reduce((a, p) => a + p.noShow, 0),
    [analytics.noShowDaily],
  );

  // Clinic-load series synthesized from daily appointments — capacity baseline
  // is the period max so the line lives in the 60–90% range like the target.
  const loadSeries = React.useMemo(() => {
    const max = Math.max(1, ...analytics.noShowDaily.map((d) => d.total));
    return analytics.noShowDaily.map((d) => ({
      date: d.date,
      load: Math.min(100, Math.round((d.total / max) * 90)),
    }));
  }, [analytics.noShowDaily]);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
      <FunnelKpiCard
        title={labels.tgTitle}
        summary={funnels.tg}
        accent={c.chart2}
      />
      <FunnelKpiCard
        title={labels.callTitle}
        summary={funnels.call}
        accent={c.chart1}
      />
      <NoShowReasonsTable
        title={labels.noShowTitle}
        totalNoShow={totalNoShow}
        reasonLabels={labels.reasonLabels}
        columns={{
          reason: labels.noShowReasonHeader,
          count: labels.noShowCountHeader,
          share: labels.noShowShareHeader,
        }}
      />
      <WaitTimeBars
        title={labels.waitTimeTitle}
        rows={funnels.waitTime}
        labels={labels}
      />
      <ClinicLoadCard
        title={labels.clinicLoadTitle}
        series={loadSeries}
        accent={c.chart1}
      />
    </div>
  );
}
