"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import type { PatientsStats } from "../_hooks/use-patients-stats";

export interface DemographicsWidgetProps {
  stats: PatientsStats | undefined;
  isLoading: boolean;
}

const GENDER_COLORS: Record<string, string> = {
  MALE: "#3DD5C0", // primary teal
  FEMALE: "#EC4899", // pink
  null: "#94a3b8", // slate for unknown
};

/**
 * Gender distribution donut + age-group breakdown.
 */
export function DemographicsWidget({ stats, isLoading }: DemographicsWidgetProps) {
  const t = useTranslations("patients.widgets");

  const genderData = React.useMemo(() => {
    if (!stats?.gender) return [];
    return stats.gender.map((g) => ({
      id: g.gender ?? "unknown",
      key: g.gender ?? "null",
      value: g.count,
      label:
        g.gender === "MALE"
          ? t("male")
          : g.gender === "FEMALE"
            ? t("female")
            : t("unknown"),
    }));
  }, [stats, t]);

  const total = genderData.reduce((sum, d) => sum + d.value, 0);
  const ageGroups = stats?.ageGroups ?? [];

  return (
    <section className="rounded-lg border border-border bg-background p-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("demographics")}
      </h4>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
          …
        </div>
      ) : total === 0 ? (
        <p className="text-xs text-muted-foreground">{t("demographicsEmpty")}</p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <div className="h-24 w-24 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={genderData}
                    dataKey="value"
                    innerRadius={28}
                    outerRadius={42}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {genderData.map((entry) => (
                      <Cell
                        key={entry.id}
                        fill={GENDER_COLORS[entry.key] ?? "#94a3b8"}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="flex-1 space-y-1 text-xs">
              {genderData.map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ backgroundColor: GENDER_COLORS[d.key] ?? "#94a3b8" }}
                  />
                  <span className="flex-1 truncate text-muted-foreground">
                    {d.label}
                  </span>
                  <span className="font-medium text-foreground">
                    {d.value}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {ageGroups.length > 0 ? (
            <div className="mt-3 border-t border-border pt-2">
              <p className="mb-1 text-xs text-muted-foreground">
                {t("ageGroups")}
              </p>
              <ul className="grid grid-cols-2 gap-1 text-xs">
                {ageGroups.map((g) => (
                  <li
                    key={g.group}
                    className="flex items-center justify-between rounded bg-muted/40 px-2 py-1"
                  >
                    <span className="text-muted-foreground">{g.group}</span>
                    <span className="font-medium text-foreground">
                      {g.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
