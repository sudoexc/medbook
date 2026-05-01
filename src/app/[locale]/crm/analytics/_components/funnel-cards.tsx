"use client";

/**
 * Phase 8a — Conversion-funnel KPI cards.
 *
 * Four cards rendered below the existing 7 chart sections on /crm/analytics:
 *   1. TG → запись (rate, n/m, sparkline)
 *   2. Звонок → запись (rate, n/m, sparkline)
 *   3. No-show top-10 (doctors + services tabs)
 *   4. Среднее ожидание (per doctor)
 *
 * Sparklines use the same `recharts` import as the parent module — this file
 * is only loaded via `next/dynamic` from the analytics page client, so the
 * recharts cost is paid once.
 */
import * as React from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import { useChartColors } from "@/hooks/use-chart-colors";

import type {
  DoctorNoShowRow,
  FunnelSummary,
  FunnelsResponse,
  ServiceNoShowRow,
  WaitTimeRow,
} from "./analytics-types";

export interface FunnelCardsProps {
  data: FunnelsResponse;
  locale: "ru" | "uz";
  labels: {
    tgTitle: string;
    callTitle: string;
    noShowTitle: string;
    waitTimeTitle: string;
    rate: string;
    converted: string;
    of: string;
    sparkTooltipDate: string;
    sparkTooltipRate: string;
    noShowDoctorsTab: string;
    noShowServicesTab: string;
    noShowEmpty: string;
    waitTimeEmpty: string;
    waitColumnDoctor: string;
    waitColumnAvg: string;
    waitColumnSamples: string;
    seconds: string;
    minutes: string;
    pickName: (row: { name: string; nameUz: string | null }) => string;
  };
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatWait(sec: number, labels: { seconds: string; minutes: string }): string {
  if (sec < 90) return `${sec} ${labels.seconds}`;
  return `${(sec / 60).toFixed(1)} ${labels.minutes}`;
}

function FunnelCard({
  title,
  summary,
  labels,
  accent,
}: {
  title: string;
  summary: FunnelSummary;
  labels: FunnelCardsProps["labels"];
  accent: string;
}) {
  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="analytics-funnel-card"
    >
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-3xl font-semibold leading-tight text-foreground">
            {pct(summary.rate)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {summary.converted} {labels.of} {summary.total}
          </div>
        </div>
        <div className="h-12 w-32 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={summary.daily}
              margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
            >
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(v) => [
                  `${(Number(v) * 100).toFixed(1)}%`,
                  labels.sparkTooltipRate,
                ]}
                labelFormatter={(label) =>
                  `${labels.sparkTooltipDate}: ${String(label)}`
                }
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
      </div>
    </section>
  );
}

function NoShowList({
  rows,
  labels,
  empty,
}: {
  rows: Array<DoctorNoShowRow | ServiceNoShowRow>;
  labels: FunnelCardsProps["labels"];
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        {empty}
      </div>
    );
  }
  return (
    <ol className="space-y-1.5">
      {rows.map((r, idx) => (
        <li
          key={"doctorId" in r ? r.doctorId : r.serviceId}
          className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/40 px-3 py-2 text-sm"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
              {idx + 1}
            </span>
            <span className="truncate text-foreground">
              {labels.pickName(r)}
            </span>
          </span>
          <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
            <span className="text-base font-semibold text-[color:var(--destructive)]">
              {pct(r.rate)}
            </span>
            <span className="text-xs text-muted-foreground">
              {r.noShow}/{r.total}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function NoShowCard({
  title,
  byDoctor,
  byService,
  labels,
}: {
  title: string;
  byDoctor: DoctorNoShowRow[];
  byService: ServiceNoShowRow[];
  labels: FunnelCardsProps["labels"];
}) {
  const [tab, setTab] = React.useState<"doctors" | "services">("doctors");
  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="analytics-funnel-card"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <div className="inline-flex rounded-md border border-border bg-background p-0.5">
          <button
            type="button"
            className={
              "h-6 px-2 text-xs font-medium rounded-sm transition " +
              (tab === "doctors"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground")
            }
            onClick={() => setTab("doctors")}
          >
            {labels.noShowDoctorsTab}
          </button>
          <button
            type="button"
            className={
              "h-6 px-2 text-xs font-medium rounded-sm transition " +
              (tab === "services"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground")
            }
            onClick={() => setTab("services")}
          >
            {labels.noShowServicesTab}
          </button>
        </div>
      </div>
      <div className="mt-3">
        {tab === "doctors" ? (
          <NoShowList rows={byDoctor} labels={labels} empty={labels.noShowEmpty} />
        ) : (
          <NoShowList rows={byService} labels={labels} empty={labels.noShowEmpty} />
        )}
      </div>
    </section>
  );
}

function WaitTimeCard({
  title,
  rows,
  labels,
}: {
  title: string;
  rows: WaitTimeRow[];
  labels: FunnelCardsProps["labels"];
}) {
  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="analytics-funnel-card"
    >
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-3">
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            {labels.waitTimeEmpty}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="pb-2 text-left font-medium">{labels.waitColumnDoctor}</th>
                <th className="pb-2 text-right font-medium">{labels.waitColumnAvg}</th>
                <th className="pb-2 text-right font-medium">{labels.waitColumnSamples}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.doctorId} className="border-t border-border/60">
                  <td className="py-1.5 text-foreground">{labels.pickName(r)}</td>
                  <td className="py-1.5 text-right tabular-nums font-medium">
                    {formatWait(r.avgWaitSec, labels)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                    {r.samples}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export function FunnelCards({ data, labels }: FunnelCardsProps) {
  const c = useChartColors();
  return (
    <div
      className="grid grid-cols-1 gap-4 lg:grid-cols-2"
      data-testid="analytics-funnels"
    >
      <FunnelCard
        title={labels.tgTitle}
        summary={data.tg}
        labels={labels}
        accent={c.chart2}
      />
      <FunnelCard
        title={labels.callTitle}
        summary={data.call}
        labels={labels}
        accent={c.chart1}
      />
      <NoShowCard
        title={labels.noShowTitle}
        byDoctor={data.noShowByDoctor}
        byService={data.noShowByService}
        labels={labels}
      />
      <WaitTimeCard
        title={labels.waitTimeTitle}
        rows={data.waitTime}
        labels={labels}
      />
    </div>
  );
}
