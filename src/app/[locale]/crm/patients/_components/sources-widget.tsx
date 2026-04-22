"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import type { PatientsStats } from "../_hooks/use-patients-stats";

export interface SourcesWidgetProps {
  stats: PatientsStats | undefined;
  isLoading: boolean;
}

const SOURCE_COLORS: Record<string, string> = {
  WEBSITE: "#3DD5C0",
  TELEGRAM: "#0EA5E9",
  INSTAGRAM: "#EC4899",
  CALL: "#F59E0B",
  WALKIN: "#8B5CF6",
  REFERRAL: "#22C55E",
  ADS: "#EF4444",
  OTHER: "#94a3b8",
  null: "#cbd5e1",
};

export function SourcesWidget({ stats, isLoading }: SourcesWidgetProps) {
  const t = useTranslations("patients.widgets");
  const tSource = useTranslations("patients.source");

  const data = React.useMemo(() => {
    if (!stats?.sources) return [];
    return stats.sources
      .filter((s) => s.count > 0)
      .map((s) => ({
        key: s.source ?? "null",
        label:
          s.source === null
            ? "—"
            : tSource(s.source.toLowerCase() as never),
        value: s.count,
      }))
      .sort((a, b) => b.value - a.value);
  }, [stats, tSource]);

  return (
    <section className="rounded-lg border border-border bg-background p-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("sources")}
      </h4>
      {isLoading ? (
        <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
          …
        </div>
      ) : data.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("sourcesEmpty")}</p>
      ) : (
        <div className="h-[140px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ left: 0, right: 12, top: 4, bottom: 4 }}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fontSize: 11, fill: "currentColor" }}
                axisLine={false}
                tickLine={false}
                width={80}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {data.map((d) => (
                  <Cell
                    key={d.key}
                    fill={SOURCE_COLORS[d.key] ?? "#94a3b8"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
