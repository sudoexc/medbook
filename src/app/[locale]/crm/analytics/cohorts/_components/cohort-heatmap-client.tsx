"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/atoms/empty-state";
import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";

import type { CohortMatrix } from "@/server/analytics/cohort-resolver";

export interface CohortHeatmapClientProps {
  matrix: CohortMatrix;
  defaultFromMonth: string;
  defaultToMonth: string;
}

/**
 * Cohort retention heatmap.
 *
 * Cells render with a single tenant-brand HSL ramp keyed by retention pct.
 * We don't pull a color lib — Tailwind's `style={{ backgroundColor: hsl(...) }}`
 * keeps bundle size flat.
 */
export function CohortHeatmapClient({
  matrix,
  defaultFromMonth,
  defaultToMonth,
}: CohortHeatmapClientProps) {
  const t = useTranslations("analyticsCohorts");

  const [fromMonth, setFromMonth] = React.useState(defaultFromMonth);
  const [toMonth, setToMonth] = React.useState(defaultToMonth);

  // Re-derive the visible cohorts whenever the toolbar moves.
  const cohortsInRange = React.useMemo(
    () =>
      matrix.cohorts.filter(
        (c) => c >= fromMonth && c <= toMonth,
      ),
    [matrix.cohorts, fromMonth, toMonth],
  );

  // Group cells by cohort for fast lookup. The MV gives us
  // (cohort, monthOffset, activePatientCount); the cohort-size baseline
  // is the row at offset=0.
  const byCohort = React.useMemo(() => {
    const map = new Map<string, Map<number, number>>();
    for (const c of matrix.cells) {
      let row = map.get(c.cohortMonth);
      if (!row) {
        row = new Map();
        map.set(c.cohortMonth, row);
      }
      row.set(c.monthOffset, c.activePatientCount);
    }
    return map;
  }, [matrix.cells]);

  // Max month-offset across the visible cohorts caps the X axis. We never
  // render more than 24 columns even if a cohort is older — that's the MV
  // window — but we still cap at min(maxOffset+1, 24).
  const maxOffset = React.useMemo(() => {
    let m = 0;
    for (const c of cohortsInRange) {
      const row = byCohort.get(c);
      if (!row) continue;
      for (const off of row.keys()) if (off > m) m = off;
    }
    return Math.min(m, 23);
  }, [cohortsInRange, byCohort]);

  if (cohortsInRange.length === 0) {
    return (
      <PageContainer>
        <SectionHeader title={t("title")} subtitle={t("subtitle")} />
        <EmptyState title={t("empty")} description={t("emptyHint")} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <SectionHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <RangeToolbar
            fromMonth={fromMonth}
            toMonth={toMonth}
            onFromChange={setFromMonth}
            onToChange={setToMonth}
            availableCohorts={matrix.cohorts}
          />
        }
      />

      <div className="motion-fade-in overflow-x-auto rounded-lg border border-border bg-card">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium text-muted-foreground">
                {t("axis.cohort")}
              </th>
              {Array.from({ length: maxOffset + 1 }).map((_, i) => (
                <th
                  key={i}
                  className="px-2 py-2 text-center font-medium text-muted-foreground"
                  title={t("axis.monthOffsetTooltip", { offset: i })}
                >
                  M+{i}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohortsInRange.map((cohort) => {
              const row = byCohort.get(cohort);
              const cohortSize = row?.get(0) ?? 0;
              return (
                <tr key={cohort} className="border-t border-border">
                  <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium text-foreground">
                    <div>{cohort}</div>
                    <div className="text-[10px] font-normal text-muted-foreground">
                      n={cohortSize}
                    </div>
                  </th>
                  {Array.from({ length: maxOffset + 1 }).map((_, off) => {
                    const active = row?.get(off) ?? 0;
                    return (
                      <CohortCell
                        key={off}
                        cohort={cohort}
                        monthOffset={off}
                        active={active}
                        cohortSize={cohortSize}
                        cellTooltip={t("cellTooltip", {
                          cohort,
                          offset: off,
                          active,
                          cohortSize,
                          pct: cohortSize > 0
                            ? Math.round((active / cohortSize) * 100)
                            : 0,
                        })}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("metaHint", {
          generatedAt: new Date(matrix.generatedAt).toLocaleString(),
          source: matrix.source,
        })}
      </p>
    </PageContainer>
  );
}

function CohortCell({
  cohortSize,
  active,
  cellTooltip,
}: {
  cohort: string;
  monthOffset: number;
  active: number;
  cohortSize: number;
  cellTooltip: string;
}) {
  // Rendered an empty muted square for cells where the cohort had no patients
  // (i.e. the matrix is sparse for that offset).
  if (cohortSize <= 0) {
    return (
      <td
        className="border-l border-border bg-muted/40 px-2 py-2 text-center"
        title={cellTooltip}
      >
        &nbsp;
      </td>
    );
  }
  const pct = Math.max(0, Math.min(1, active / cohortSize));
  // Tenant-brand HSL ramp: white at 0 → primary at 1. The L axis carries the
  // intensity, hue stays fixed on the violet-leaning brand color.
  const lightness = Math.round(98 - 50 * pct);
  const bg = `hsl(258 70% ${lightness}%)`;
  const fg = pct > 0.55 ? "white" : "var(--foreground)";
  return (
    <td
      className="border-l border-border px-2 py-2 text-center font-semibold tabular-nums"
      style={{ backgroundColor: bg, color: fg }}
      title={cellTooltip}
    >
      {Math.round(pct * 100)}%
    </td>
  );
}

function RangeToolbar({
  fromMonth,
  toMonth,
  onFromChange,
  onToChange,
  availableCohorts,
}: {
  fromMonth: string;
  toMonth: string;
  onFromChange: (m: string) => void;
  onToChange: (m: string) => void;
  availableCohorts: string[];
}) {
  const t = useTranslations("analyticsCohorts");

  const min = availableCohorts[0] ?? fromMonth;
  const max = availableCohorts[availableCohorts.length - 1] ?? toMonth;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label className="flex items-center gap-1.5 text-muted-foreground">
        {t("toolbar.from")}
        <input
          type="month"
          value={fromMonth}
          min={min}
          max={toMonth}
          onChange={(e) => onFromChange(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-1 text-foreground"
        />
      </label>
      <label className="flex items-center gap-1.5 text-muted-foreground">
        {t("toolbar.to")}
        <input
          type="month"
          value={toMonth}
          min={fromMonth}
          max={max}
          onChange={(e) => onToChange(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-1 text-foreground"
        />
      </label>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={() => {
          onFromChange(min);
          onToChange(max);
        }}
      >
        {t("toolbar.allTime")}
      </Button>
    </div>
  );
}
