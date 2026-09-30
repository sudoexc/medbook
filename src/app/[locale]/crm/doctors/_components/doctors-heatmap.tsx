"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

import type { DoctorRow } from "../_hooks/use-doctors-list";
import type { DoctorToday } from "../_hooks/use-doctors-stats";

export interface DoctorsHeatmapProps {
  doctors: DoctorRow[];
  /** Today per doctor, with its hour-by-hour minutes (DR-08). */
  today: DoctorToday[];
  className?: string;
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[1]?.[0]?.toUpperCase() ?? ""}.`;
  }
  return name;
}

function cellColor(pct: number): { bg: string; fg: string } {
  if (pct === 0) return { bg: "bg-muted/50", fg: "text-muted-foreground" };
  if (pct < 30)
    return {
      bg: "bg-destructive/15",
      fg: "text-destructive",
    };
  if (pct < 60)
    return {
      bg: "bg-warning/20",
      fg: "text-warning",
    };
  if (pct < 80)
    return {
      bg: "bg-success/20",
      fg: "text-success",
    };
  return {
    bg: "bg-success/35",
    fg: "text-success",
  };
}

/**
 * Hour-by-doctor heatmap ("Загрузка врачей по времени") — docs/6 - Врачи.png.
 * Rows: the hours anyone works or is booked today · Columns: the active
 * doctors who work or are booked today · Cell: booked minutes / working
 * minutes of that hour, from the schedule and the real visit lengths
 * (audit DR-08). It used to assume two visits an hour, 09:00 to 18:00, for
 * the first five doctors by name, deactivated ones included. An hour
 * outside the doctor's schedule reads «—».
 */
export function DoctorsHeatmap({ doctors, today, className }: DoctorsHeatmapProps) {
  const locale = useLocale();
  const t = useTranslations("crmDoctors.heatmap");

  const { visible, hours, byDoctor } = React.useMemo(() => {
    const byDoctor = new Map<string, Map<number, { workingMin: number; bookedMin: number }>>();
    for (const r of today) {
      if (r.hours.length === 0) continue;
      byDoctor.set(r.doctorId, new Map(r.hours.map((h) => [h.hour, h])));
    }
    const visible = doctors.filter((d) => d.isActive && byDoctor.has(d.id));
    const hourSet = new Set<number>();
    for (const d of visible) for (const h of byDoctor.get(d.id)!.keys()) hourSet.add(h);
    const sorted = [...hourSet].sort((a, b) => a - b);
    const hours =
      sorted.length > 0
        ? Array.from(
            { length: sorted[sorted.length - 1]! - sorted[0]! + 1 },
            (_, i) => sorted[0]! + i,
          )
        : [];
    return { visible, hours, byDoctor };
  }, [doctors, today]);

  if (visible.length === 0) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-border bg-card p-4",
          className,
        )}
      >
        <h3 className="text-[13px] font-semibold text-foreground">
          {t("title")}
        </h3>
        <p className="mt-2 text-[12px] text-muted-foreground">
          {t("noWorkToday")}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border border-border bg-card p-4",
        className,
      )}
    >
      <h3 className="text-[13px] font-semibold text-foreground">
        {t("title")}
      </h3>

      <div className="mt-3 overflow-x-auto">
        <div
          className="grid min-w-[420px] gap-0.5 text-[11px]"
          style={{
            gridTemplateColumns: `72px repeat(${visible.length}, minmax(56px, 1fr))`,
          }}
        >
          <div className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("timeHeader")}
          </div>
          {visible.map((d) => {
            const name = locale === "uz" ? d.nameUz : d.nameRu;
            return (
              <div
                key={d.id}
                className="truncate px-1 pb-1 text-center text-[11px] font-medium text-foreground"
                title={name}
              >
                {shortName(name)}
              </div>
            );
          })}
          {hours.map((hour) => (
            <React.Fragment key={hour}>
              <div className="flex items-center px-1 py-0.5 text-[11px] font-medium text-muted-foreground">
                {String(hour).padStart(2, "0")}:00
              </div>
              {visible.map((d) => {
                const cell = byDoctor.get(d.id)?.get(hour);
                const working = cell?.workingMin ?? 0;
                const booked = cell?.bookedMin ?? 0;
                if (working === 0) {
                  return (
                    <div
                      key={`${d.id}-${hour}`}
                      className="flex items-center justify-center rounded-md bg-muted/30 py-1 text-[11px] text-muted-foreground"
                      title={t("offHours")}
                    >
                      —
                    </div>
                  );
                }
                const pct = Math.round((booked / working) * 100);
                const tone = cellColor(Math.min(100, pct));
                return (
                  <div
                    key={`${d.id}-${hour}`}
                    className={cn(
                      "flex items-center justify-center rounded-md py-1 text-[11px] font-semibold tabular-nums",
                      tone.bg,
                      tone.fg,
                    )}
                    title={t("cellTitleMinutes", { booked, working })}
                  >
                    {pct}%
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <LegendDot className="bg-destructive" label={t("legendLow")} />
        <LegendDot
          className="bg-warning"
          label={t("legendMedium")}
        />
        <LegendDot
          className="bg-success/70"
          label={t("legendGood")}
        />
        <LegendDot
          className="bg-success"
          label={t("legendHigh")}
        />
      </div>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", className)} aria-hidden />
      {label}
    </span>
  );
}
