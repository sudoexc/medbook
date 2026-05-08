"use client";

/**
 * Stacked-area daily loss chart for /crm/analytics/loss. Recharts is heavy
 * (~90KB min+gzip) so the parent client component dynamic-imports this
 * file with `ssr: false`.
 */

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMoney } from "@/lib/format";
import { useChartColors } from "@/hooks/use-chart-colors";

import type { DailyLossPointWire } from "./loss-types";

export interface LossChartProps {
  daily: DailyLossPointWire[];
  locale: "ru" | "uz";
  labels: {
    emptySlot: string;
    noShow: string;
    cancellation: string;
    dormant: string;
  };
}

export function LossChart({ daily, locale, labels }: LossChartProps) {
  const c = useChartColors();

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
      <AreaChart data={daily}>
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
          formatter={(value, name) => [money(Number(value)), String(name)]}
          labelFormatter={(label) => dayLabel(String(label))}
        />
        <Legend />
        <Area
          type="monotone"
          dataKey="emptySlot"
          stackId="1"
          stroke={c.chart1}
          fill={c.chart1}
          fillOpacity={0.6}
          name={labels.emptySlot}
        />
        <Area
          type="monotone"
          dataKey="noShow"
          stackId="1"
          stroke={c.chart3}
          fill={c.chart3}
          fillOpacity={0.6}
          name={labels.noShow}
        />
        <Area
          type="monotone"
          dataKey="cancellation"
          stackId="1"
          stroke={c.chart5}
          fill={c.chart5}
          fillOpacity={0.6}
          name={labels.cancellation}
        />
        <Area
          type="monotone"
          dataKey="dormant"
          stackId="1"
          stroke={c.chart4}
          fill={c.chart4}
          fillOpacity={0.6}
          name={labels.dormant}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
