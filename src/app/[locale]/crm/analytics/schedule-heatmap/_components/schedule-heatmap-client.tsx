"use client";

import * as React from "react";
import { useTranslations, useLocale } from "next-intl";

import { EmptyState } from "@/components/atoms/empty-state";
import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import type { ScheduleHeatmapCell } from "@/server/analytics/schedule-heatmap-resolver";

interface DoctorMeta {
  id: string;
  nameRu: string;
  nameUz: string;
}

export interface ScheduleHeatmapClientProps {
  cells: ScheduleHeatmapCell[];
  generatedAt: string;
  source: string;
  doctors: DoctorMeta[];
}

const DAY_KEYS: ReadonlyArray<{ key: string; iso: number }> = [
  { key: "mon", iso: 1 },
  { key: "tue", iso: 2 },
  { key: "wed", iso: 3 },
  { key: "thu", iso: 4 },
  { key: "fri", iso: 5 },
  { key: "sat", iso: 6 },
  { key: "sun", iso: 7 },
];

// 24 hours; we show every hour but compact the label every 3h to keep the
// grid readable on a 14" laptop.
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const ALL_DOCTORS = "__all__";

/**
 * 7 × 24 schedule heatmap. Cell intensity is keyed off `appointmentCount`
 * relative to the busiest cell in the current view (per-doctor or all).
 *
 * The "italic 90-day" subtitle is required copy from the brief — we render
 * it under the section title so it's visible without scrolling.
 */
export function ScheduleHeatmapClient({
  cells,
  generatedAt,
  source,
  doctors,
}: ScheduleHeatmapClientProps) {
  const t = useTranslations("analyticsScheduleHeatmap");
  const locale = useLocale();

  const [doctorId, setDoctorId] = React.useState<string>(ALL_DOCTORS);

  const doctorName = React.useCallback(
    (d: DoctorMeta) => (locale === "uz" && d.nameUz ? d.nameUz : d.nameRu),
    [locale],
  );

  // (dayOfWeek, hour) → { appointments, slots }. When ALL_DOCTORS is active
  // we sum across doctors. Memoised so flipping the selector is one
  // recomputation per click.
  const aggregated = React.useMemo(() => {
    const map = new Map<string, { appts: number; slots: number }>();
    for (const c of cells) {
      if (doctorId !== ALL_DOCTORS && c.doctorId !== doctorId) continue;
      const k = `${c.dayOfWeek}-${c.hour}`;
      const cur = map.get(k) ?? { appts: 0, slots: 0 };
      cur.appts += c.appointmentCount;
      cur.slots += c.availableSlotCount;
      map.set(k, cur);
    }
    return map;
  }, [cells, doctorId]);

  const maxAppts = React.useMemo(() => {
    let m = 0;
    for (const v of aggregated.values()) if (v.appts > m) m = v.appts;
    return m;
  }, [aggregated]);

  if (cells.length === 0) {
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
        subtitle={
          <>
            <span>{t("subtitle")}</span>
            <span className="ml-2 italic text-muted-foreground">
              {t("windowHint")}
            </span>
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={doctorId === ALL_DOCTORS ? "default" : "ghost"}
              className="h-7 px-3 text-xs"
              onClick={() => setDoctorId(ALL_DOCTORS)}
            >
              {t("allDoctors")}
            </Button>
            <select
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            >
              <option value={ALL_DOCTORS}>{t("allDoctors")}</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {doctorName(d)}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card px-2 py-2 text-left font-medium text-muted-foreground">
                {t("axis.day")}
              </th>
              {HOURS.map((h) => (
                <th
                  key={h}
                  className="px-1 py-2 text-center font-medium text-muted-foreground"
                  title={t("axis.hourTooltip", { hour: h })}
                >
                  {h % 3 === 0 ? `${String(h).padStart(2, "0")}` : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAY_KEYS.map(({ key, iso }) => (
              <tr key={key} className="border-t border-border">
                <th className="sticky left-0 z-10 bg-card px-2 py-2 text-left font-medium text-foreground">
                  {t(`days.${key}`)}
                </th>
                {HOURS.map((h) => {
                  const v = aggregated.get(`${iso}-${h}`);
                  return (
                    <HeatmapCell
                      key={h}
                      appts={v?.appts ?? 0}
                      slots={v?.slots ?? 0}
                      max={maxAppts}
                      tooltip={t("cellTooltip", {
                        day: t(`days.${key}`),
                        hour: h,
                        appts: v?.appts ?? 0,
                        slots: v?.slots ?? 0,
                      })}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("metaHint", {
          generatedAt: new Date(generatedAt).toLocaleString(),
          source,
        })}
      </p>
    </PageContainer>
  );
}

function HeatmapCell({
  appts,
  slots,
  max,
  tooltip,
}: {
  appts: number;
  slots: number;
  max: number;
  tooltip: string;
}) {
  const intensity = max > 0 ? Math.max(0, Math.min(1, appts / max)) : 0;
  // Cap empty cells with a faint muted square so the grid stays legible
  // even on weeknights with zero appointments.
  if (appts === 0 && slots === 0) {
    return (
      <td
        className="border-l border-border bg-muted/30 px-1 py-2 text-center"
        title={tooltip}
      >
        &nbsp;
      </td>
    );
  }
  // Same violet-leaning brand ramp as the cohort heatmap so the two
  // dashboards feel like siblings.
  const lightness = Math.round(98 - 50 * intensity);
  const bg = `hsl(258 70% ${lightness}%)`;
  const fg = intensity > 0.55 ? "white" : "var(--foreground)";
  return (
    <td
      className="border-l border-border px-1 py-2 text-center font-semibold tabular-nums"
      style={{ backgroundColor: bg, color: fg }}
      title={tooltip}
    >
      {appts > 0 ? appts : ""}
    </td>
  );
}
