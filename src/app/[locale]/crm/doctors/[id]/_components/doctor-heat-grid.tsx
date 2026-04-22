"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import {
  useDoctorAppointments,
  type DoctorAppointment,
} from "../_hooks/use-doctor-appointments";

/**
 * Heat-grid of appointments over a week window — 7 rows (Mon..Sun) x 14 cols
 * (hours 8..22). Intensity = number of appointments in that hour cell.
 *
 * Current week by default with prev/next navigation. The heat-grid sources
 * from `/api/crm/appointments?doctorId=&from=&to=` — same endpoint as the
 * calendar; no new API needed.
 */
export interface DoctorHeatGridProps {
  doctorId: string;
  className?: string;
}

const HOURS = Array.from({ length: 15 }, (_, i) => 8 + i); // 8..22 inclusive
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Convert JS Date.getDay() (0=Sun..6=Sat) to 0=Mon..6=Sun. */
function mondayFirstIndex(d: Date): number {
  const js = d.getDay();
  return js === 0 ? 6 : js - 1;
}

/** Monday 00:00 of the week containing `anchor` (local time). */
function startOfWeek(anchor: Date): Date {
  const d = new Date(anchor);
  d.setHours(0, 0, 0, 0);
  const weekday = mondayFirstIndex(d);
  d.setDate(d.getDate() - weekday);
  return d;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(d.getDate() + days);
  return next;
}

function isoRange(anchor: Date): { from: string; to: string } {
  const start = startOfWeek(anchor);
  const end = addDays(start, 7);
  return { from: start.toISOString(), to: end.toISOString() };
}

function formatRange(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "2-digit",
  });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

type Cell = { day: number; hour: number; count: number };

function buildGrid(
  rows: DoctorAppointment[],
  weekStart: Date,
): { cells: Cell[]; max: number } {
  const grid = new Map<string, number>();
  let max = 0;
  const weekEnd = addDays(weekStart, 7);

  for (const r of rows) {
    // Parse the absolute appointment date; match against the week window.
    const when = new Date(r.date);
    if (!Number.isFinite(when.getTime())) continue;
    if (when < weekStart || when >= weekEnd) continue;

    // Prefer explicit time field when present, fall back to date's hour.
    let hour = when.getHours();
    if (r.time) {
      const m = /^([0-9]{1,2}):([0-9]{2})$/.exec(r.time);
      if (m) hour = Number(m[1]);
    }
    if (hour < HOURS[0]! || hour > HOURS[HOURS.length - 1]!) continue;

    const day = mondayFirstIndex(when);
    const key = `${day}:${hour}`;
    const next = (grid.get(key) ?? 0) + 1;
    grid.set(key, next);
    if (next > max) max = next;
  }

  const cells: Cell[] = [];
  for (const d of DAY_KEYS.map((_, i) => i)) {
    for (const h of HOURS) {
      cells.push({ day: d, hour: h, count: grid.get(`${d}:${h}`) ?? 0 });
    }
  }
  return { cells, max };
}

function intensityClass(count: number, max: number): string {
  if (count === 0 || max === 0) return "bg-muted";
  const ratio = count / max;
  if (ratio < 0.25) return "bg-primary/20";
  if (ratio < 0.5) return "bg-primary/40";
  if (ratio < 0.75) return "bg-primary/60";
  return "bg-primary/90";
}

export function DoctorHeatGrid({ doctorId, className }: DoctorHeatGridProps) {
  const t = useTranslations("crmDoctors.heatGrid");

  const [anchor, setAnchor] = React.useState(() => new Date());
  const weekStart = React.useMemo(() => startOfWeek(anchor), [anchor]);
  const weekEnd = React.useMemo(
    () => addDays(weekStart, 6),
    [weekStart],
  );
  const range = React.useMemo(() => isoRange(anchor), [anchor]);

  const query = useDoctorAppointments(doctorId, range);
  const rows = query.data?.rows ?? [];

  const { cells, max } = React.useMemo(
    () => buildGrid(rows, weekStart),
    [rows, weekStart],
  );

  const totalThisWeek = cells.reduce((acc, c) => acc + c.count, 0);

  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]",
        className,
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {t("title")}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("prev")}
            onClick={() => setAnchor((d) => addDays(d, -7))}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <span className="min-w-[130px] text-center text-xs text-muted-foreground">
            {formatRange(weekStart, weekEnd)}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("next")}
            onClick={() => setAnchor((d) => addDays(d, 7))}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={() => setAnchor(new Date())}
          >
            {t("currentWeek")}
          </Button>
        </div>
      </div>

      {query.isLoading ? (
        <div className="h-40 animate-pulse rounded-md bg-muted" />
      ) : totalThisWeek === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-10 text-center text-xs text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="inline-grid" style={{ gridTemplateColumns: `auto repeat(${HOURS.length}, minmax(28px, 1fr))` }}>
            <div />
            {HOURS.map((h) => (
              <div
                key={h}
                className="pb-1 text-center text-[10px] font-medium text-muted-foreground"
              >
                {h}
              </div>
            ))}
            {DAY_KEYS.map((dayKey, dayIdx) => (
              <React.Fragment key={dayKey}>
                <div className="pr-2 text-right text-xs font-medium text-muted-foreground">
                  {t(`weekdays.${dayKey}` as never)}
                </div>
                {HOURS.map((h) => {
                  const cell = cells.find(
                    (c) => c.day === dayIdx && c.hour === h,
                  );
                  const count = cell?.count ?? 0;
                  return (
                    <div
                      key={`${dayKey}:${h}`}
                      className={cn(
                        "m-[1px] h-6 rounded-sm",
                        intensityClass(count, max),
                      )}
                      title={count > 0 ? `${count}` : undefined}
                      role="img"
                      aria-label={
                        count > 0
                          ? `${h}:00 · ${count}`
                          : `${h}:00`
                      }
                    />
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>{t("legendLow")}</span>
        <span className="size-3 rounded-sm bg-muted" />
        <span className="size-3 rounded-sm bg-primary/20" />
        <span className="size-3 rounded-sm bg-primary/40" />
        <span className="size-3 rounded-sm bg-primary/60" />
        <span className="size-3 rounded-sm bg-primary/90" />
        <span>{t("legendHigh")}</span>
      </div>
    </section>
  );
}
