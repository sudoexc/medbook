"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

import type { DoctorRow } from "../_hooks/use-doctors-list";
import type { DoctorAggregateAppointment } from "../_hooks/use-doctors-stats";

export interface DoctorsHeatmapProps {
  doctors: DoctorRow[];
  /** Today's appointments across ALL doctors (we filter internally) */
  appointments: DoctorAggregateAppointment[];
  /** Estimated appointments per hour per doctor at 100% load */
  perHourCapacity?: number;
  className?: string;
}

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

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
      bg: "bg-[color:var(--warning,#f59e0b)]/20",
      fg: "text-[color:var(--warning,#f59e0b)]",
    };
  if (pct < 80)
    return {
      bg: "bg-[color:var(--success,#10b981)]/20",
      fg: "text-[color:var(--success,#10b981)]",
    };
  return {
    bg: "bg-[color:var(--success,#10b981)]/35",
    fg: "text-[color:var(--success,#10b981)]",
  };
}

/**
 * Hour-by-doctor heatmap ("Загрузка врачей по времени") — docs/6 - Врачи.png.
 * Rows: 09:00–18:00 · Columns: doctors · Cell: load % with legend-coded tint.
 */
export function DoctorsHeatmap({
  doctors,
  appointments,
  perHourCapacity = 2,
  className,
}: DoctorsHeatmapProps) {
  const locale = useLocale();
  const t = useTranslations("crmDoctors.heatmap");

  const grid = React.useMemo(() => {
    // counts[doctorId][hour] = number of appointments
    const counts: Record<string, Record<number, number>> = {};
    for (const a of appointments) {
      const d = new Date(a.date);
      const hour = d.getHours();
      if (hour < HOURS[0] || hour > HOURS[HOURS.length - 1]) continue;
      const id = a.doctor.id;
      counts[id] = counts[id] ?? {};
      counts[id][hour] = (counts[id][hour] ?? 0) + 1;
    }
    return counts;
  }, [appointments]);

  if (doctors.length === 0) {
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
          {t("empty")}
        </p>
      </div>
    );
  }

  // Limit to the first 5 doctors to keep the grid readable
  const visible = doctors.slice(0, 5);

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
          {HOURS.map((hour) => (
            <React.Fragment key={hour}>
              <div className="flex items-center px-1 py-0.5 text-[11px] font-medium text-muted-foreground">
                {String(hour).padStart(2, "0")}:00
              </div>
              {visible.map((d) => {
                const count = grid[d.id]?.[hour] ?? 0;
                const pct =
                  perHourCapacity > 0
                    ? Math.min(100, Math.round((count / perHourCapacity) * 100))
                    : 0;
                const tone = cellColor(pct);
                return (
                  <div
                    key={`${d.id}-${hour}`}
                    className={cn(
                      "flex items-center justify-center rounded-md py-1 text-[11px] font-semibold tabular-nums",
                      tone.bg,
                      tone.fg,
                    )}
                    title={t("cellTitle", { count, pct })}
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
          className="bg-[color:var(--warning,#f59e0b)]"
          label={t("legendMedium")}
        />
        <LegendDot
          className="bg-[color:var(--success,#10b981)]/70"
          label={t("legendGood")}
        />
        <LegendDot
          className="bg-[color:var(--success,#10b981)]"
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
