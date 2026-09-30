"use client";

/**
 * Row 4 — bottom strip of 5 cards:
 *   1. Telegram → запись (KPI value, sparkline)
 *   2. Звонок → запись (same shape, different accent)
 *   3. Неявки по врачам (3-col table: doctor / no-shows / share)
 *   4. Среднее время ожидания (horizontal bars per doctor)
 *   5. Динамика загрузки клиники (KPI value, delta chip, line chart)
 *
 * Nothing here is made up any more (audit UX-03): the no-show «reasons»
 * table spread the period's no-shows over ten fixed weights («пациент
 * забыл 22 %», «погода 3 %») though no reason is recorded anywhere, the
 * load line was each day's visits over the busiest day × 90 %, and the
 * funnel chips compared the two halves of the sparkline. The reasons table
 * is now the real no-shows per doctor, the load comes from the schedule
 * (server/analytics/clinic-load.ts) and the only chip left is the server's
 * comparison with the previous period.
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
  DoctorNoShowRow,
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
    /** «нет данных»: shown where a number cannot be computed. */
    noData: string;
    /** The no-show table with no settled visit in the period. */
    noShowEmpty: string;
    clinicLoadTitle: string;
    deltaPp: (value: string) => string;
    waitColumnDoctor: string;
    waitColumnAvg: string;
    waitColumnSamples: string;
    seconds: string;
    minutes: string;
    waitTimeEmpty: string;
    noShowDoctorHeader: string;
    noShowCountHeader: string;
    noShowShareHeader: string;
    pickName: (row: { name: string; nameUz: string | null }) => string;
  };
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
  noData,
}: {
  title: string;
  summary: FunnelSummary;
  accent: string;
  noData: string;
}) {
  // No chip: the one this card had compared the two halves of its own
  // sparkline (UX-03). A period without a single conversation has no rate
  // either, so it says «нет данных» instead of 0 %.
  return (
    <section
      className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]"
      data-testid="analytics-funnel-card"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-[13px] font-semibold text-foreground">
          {title}
        </h3>
      </div>
      <div className="mt-1 text-[20px] font-bold leading-tight text-foreground tabular-nums">
        {summary.total > 0 ? (
          <AnimatedPercent value={summary.rate} decimals={1} />
        ) : (
          <span className="text-base font-semibold text-muted-foreground">
            {noData}
          </span>
        )}
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
              animationDuration={800}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/**
 * Real no-shows per doctor over the period: missed visits and their share
 * of the visits that were due (completed + missed), highest share first
 * (`computeNoShowRanks`). Replaces a «reasons» table that invented its
 * distribution (UX-03): no reason is recorded when a visit is missed.
 */
function NoShowByDoctorTable({
  title,
  rows,
  columns,
  noData,
  pickName,
}: {
  title: string;
  rows: DoctorNoShowRow[];
  columns: { doctor: string; count: string; share: string };
  noData: string;
  pickName: (row: { name: string; nameUz: string | null }) => string;
}) {
  const shown = rows.filter((r) => r.total > 0).slice(0, 10);
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
              <th className="pb-2 text-left font-medium">{columns.doctor}</th>
              <th className="pb-2 text-right font-medium">{columns.count}</th>
              <th className="pb-2 text-right font-medium">{columns.share}</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="py-3 text-center text-[12px] text-muted-foreground"
                >
                  {noData}
                </td>
              </tr>
            ) : (
              shown.map((r) => (
                <tr key={r.doctorId} className="border-t border-border/60">
                  <td className="py-1.5 text-foreground">{pickName(r)}</td>
                  <td className="py-1.5 text-right tabular-nums font-medium text-foreground">
                    {r.noShow}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                    {(r.rate * 100).toFixed(1).replace(".", ",")}%
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
  load,
  deltaPp,
  accent,
  noData,
  deltaLabel,
}: {
  title: string;
  load: AnalyticsResponse["clinicLoad"] | undefined;
  /** Change against the previous period, percentage points; null: no chip. */
  deltaPp: number | null;
  accent: string;
  noData: string;
  deltaLabel: (value: string) => string;
}) {
  // Booked minutes against the schedule's working minutes (UX-03). A day
  // nobody works is a gap in the line, not 0 %.
  const series = load?.daily ?? [];
  const avg = load?.loadPct ?? null;

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-[13px] font-semibold text-foreground">
          {title}
        </h3>
        {deltaPp !== null ? (
          <DeltaChip
            label={deltaLabel(`${deltaPp >= 0 ? "+" : ""}${deltaPp.toFixed(1).replace(".", ",")}`)}
            positive={deltaPp >= 0}
          />
        ) : null}
      </div>
      <div className="mt-1 text-[20px] font-bold leading-tight text-foreground tabular-nums">
        {avg !== null ? (
          <AnimatedPercent value={avg} decimals={0} fromHundred />
        ) : (
          <span className="text-base font-semibold text-muted-foreground">
            {noData}
          </span>
        )}
      </div>
      <div className="mt-3 h-24 w-full">
        {avg !== null ? (
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
                connectNulls={false}
                animationDuration={800}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : null}
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

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
      <FunnelKpiCard
        title={labels.tgTitle}
        summary={funnels.tg}
        accent={c.chart2}
        noData={labels.noData}
      />
      <FunnelKpiCard
        title={labels.callTitle}
        summary={funnels.call}
        accent={c.chart1}
        noData={labels.noData}
      />
      <NoShowByDoctorTable
        title={labels.noShowTitle}
        rows={funnels.noShowByDoctor}
        noData={labels.noShowEmpty}
        pickName={labels.pickName}
        columns={{
          doctor: labels.noShowDoctorHeader,
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
        load={analytics.clinicLoad}
        deltaPp={analytics.deltas?.loadPp ?? null}
        accent={c.chart1}
        noData={labels.noData}
        deltaLabel={labels.deltaPp}
      />
    </div>
  );
}
