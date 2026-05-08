"use client";

/**
 * Forecast band chart for /crm/analytics/forecast. Shows three lines
 * (low / baseline / high) over a 30-day horizon. Recharts is dynamic-
 * imported by the parent client component.
 */

import * as React from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMoney } from "@/lib/format";
import { useChartColors } from "@/hooks/use-chart-colors";
import type { ForecastPoint } from "@/lib/revenue/forecast";

export interface ForecastChartProps {
  points: ForecastPoint[];
  locale: "ru" | "uz";
  labels: { low: string; baseline: string; high: string };
}

export function ForecastChart({ points, locale, labels }: ForecastChartProps) {
  const c = useChartColors();

  // Recharts can't draw a "band between low and high" directly, so we
  // expand each point into `bandLow = low` and `bandSpan = high - low` so
  // we can stack a transparent floor under a translucent ceiling.
  const data = React.useMemo(
    () =>
      points.map((p) => ({
        date: p.date,
        bandLow: p.low,
        bandSpan: Math.max(0, p.high - p.low),
        baseline: p.baseline,
      })),
    [points],
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
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data}>
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
          formatter={(value, name) => {
            if (name === "bandLow") return [money(Number(value)), labels.low];
            if (name === "bandSpan") return [money(Number(value)), labels.high];
            if (name === "baseline")
              return [money(Number(value)), labels.baseline];
            return [String(value), String(name)];
          }}
          labelFormatter={(label) => dayLabel(String(label))}
        />
        <Legend
          formatter={(value) => {
            if (value === "bandLow") return labels.low;
            if (value === "bandSpan") return labels.high;
            if (value === "baseline") return labels.baseline;
            return value;
          }}
        />
        {/* Floor: invisible — establishes the lower edge of the band. */}
        <Area
          type="monotone"
          dataKey="bandLow"
          stackId="band"
          stroke="transparent"
          fill="transparent"
          legendType="none"
        />
        {/* Ceiling: stacked on top so the visible region = high − low. */}
        <Area
          type="monotone"
          dataKey="bandSpan"
          stackId="band"
          stroke={c.chart2}
          fill={c.chart2}
          fillOpacity={0.2}
        />
        <Line
          type="monotone"
          dataKey="baseline"
          stroke={c.chart1}
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
