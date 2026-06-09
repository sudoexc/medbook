"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowLeftIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PrinterIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

import { useDoctorSchedule } from "../../my-day/_hooks/use-doctor-schedule";
import type {
  ScheduleEntry,
  ScheduleType,
} from "../../my-day/_hooks/use-doctor-today";

// Maps a schedule entry type to its translation key suffix under
// `agenda.type.*`. Kept as a constant so the mapping stays greppable;
// the human-readable label is resolved at render time via `t`.
const TYPE_LABEL_KEY: Record<ScheduleType, string> = {
  consultation: "consultation",
  repeat: "repeat",
  reserve: "reserve",
  break: "break",
};

const HOUR_START = 8;
const HOUR_END = 21;

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoDateToLocalDate(iso: string): Date {
  // ISO YYYY-MM-DD parsed via Date constructor would land in UTC; we want
  // the local-midnight interpretation so date math stays in the user's tz.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function daysBetween(a: Date, b: Date): number {
  const ms = startOfDay(a).getTime() - startOfDay(b).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

// Returns the translation key suffix under `agenda.relative.*` for the
// view date relative to today, or null when it's neither yesterday/today/
// tomorrow (the caller then falls back to the full date label).
function relativeLabelKey(view: Date, today: Date): string | null {
  const delta = daysBetween(view, today);
  if (delta === 0) return "today";
  if (delta === -1) return "yesterday";
  if (delta === 1) return "tomorrow";
  return null;
}

function fullDateLabel(view: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
  }).format(view);
}

function parseHHMM(time: string): { hour: number; minute: number } | null {
  const m = time.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/**
 * Compute the rendered hour window for the day. We start with the
 * static 08-21 default and widen if the doctor has appointments outside
 * that range — a 06:30 reception or a 22:00 on-call shouldn't disappear
 * off the top/bottom of the grid.
 */
function computeHourBounds(entries: ScheduleEntry[]): { start: number; end: number } {
  let start = HOUR_START;
  let end = HOUR_END;
  for (const e of entries) {
    const p = parseHHMM(e.startTime);
    if (!p) continue;
    if (p.hour < start) start = p.hour;
    const durationMin = e.durationMin ?? 30;
    const endMin = p.hour * 60 + p.minute + durationMin;
    const lastHour = Math.ceil(endMin / 60);
    if (lastHour > end) end = lastHour;
  }
  return { start, end };
}

type Slot =
  | { kind: "appointment"; entry: ScheduleEntry; rowStart: number; rowSpan: number }
  | { kind: "gap"; rowStart: number; rowSpan: number };

const SLOTS_PER_HOUR = 2;       // 30-min granularity
const PX_PER_SLOT = 40;         // visual height per 30-min slot

function layoutSlots(
  entries: ScheduleEntry[],
  hourStart: number,
  hourEnd: number,
): { slots: Slot[]; totalRows: number } {
  const totalRows = (hourEnd - hourStart) * SLOTS_PER_HOUR;
  // Map each entry to a row range (grid is 1-indexed); collisions are
  // ignored — overlapping bookings should never reach here (slot manager
  // prevents them), but if they do we just stack visually in DOM order.
  const occupied = new Set<number>();
  const layouts: Slot[] = [];

  const sorted = [...entries].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );

  for (const e of sorted) {
    if (e.status === "cancelled") continue;
    const p = parseHHMM(e.startTime);
    if (!p) continue;
    const offsetMin = (p.hour - hourStart) * 60 + p.minute;
    if (offsetMin < 0) continue;
    const rowStart = Math.floor(offsetMin / 30) + 1; // 1-indexed
    const span = Math.max(1, Math.round((e.durationMin ?? 30) / 30));
    layouts.push({ kind: "appointment", entry: e, rowStart, rowSpan: span });
    for (let i = 0; i < span; i++) occupied.add(rowStart + i);
  }

  // Fill remaining rows with gap markers so the grid feels alive even
  // on empty days (otherwise it's just a vertical ladder of hour labels).
  let gapStart: number | null = null;
  for (let row = 1; row <= totalRows; row++) {
    if (!occupied.has(row)) {
      if (gapStart === null) gapStart = row;
    } else if (gapStart !== null) {
      layouts.push({ kind: "gap", rowStart: gapStart, rowSpan: row - gapStart });
      gapStart = null;
    }
  }
  if (gapStart !== null) {
    layouts.push({
      kind: "gap",
      rowStart: gapStart,
      rowSpan: totalRows - gapStart + 1,
    });
  }

  return { slots: layouts, totalRows };
}

// Returns the translation key suffix under `agenda.status.*` plus the tone
// classes for the entry's status badge, or null when no badge applies.
function statusBadge(entry: ScheduleEntry): {
  labelKey: string;
  className: string;
} | null {
  if (entry.status === "in_progress") {
    return {
      labelKey: "inProgress",
      className: "bg-success/15 text-success",
    };
  }
  if (entry.status === "done") {
    return {
      labelKey: "done",
      className: "bg-muted text-muted-foreground",
    };
  }
  if (entry.status === "no_show") {
    return {
      labelKey: "noShow",
      className: "bg-warning/15 text-warning",
    };
  }
  if (entry.status === "cancelled") {
    return { labelKey: "cancelled", className: "bg-destructive/10 text-destructive" };
  }
  return null;
}

export function AgendaShell({ locale }: { locale: string }) {
  const t = useTranslations("doctor.schedule");
  const router = useRouter();
  const searchParams = useSearchParams();

  const today = React.useMemo(() => startOfDay(new Date()), []);
  const dateParam = searchParams.get("date");

  const initialDate = React.useMemo(() => {
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return startOfDay(isoDateToLocalDate(dateParam));
    }
    return today;
  }, [dateParam, today]);

  const [viewDate, setViewDate] = React.useState<Date>(initialDate);
  // Keep URL in sync so the date is shareable / refresh-safe.
  React.useEffect(() => {
    const iso = toIsoDate(viewDate);
    const current = searchParams.get("date");
    if (current === iso) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("date", iso);
    router.replace(`?${next.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewDate]);

  const dateKey = toIsoDate(viewDate);
  const isToday = daysBetween(viewDate, today) === 0;
  const isPast = daysBetween(viewDate, today) < 0;

  const { data, isLoading, isError } = useDoctorSchedule(dateKey);
  const entries = data?.entries ?? [];
  const summary = data?.summary;

  const { start: hourStart, end: hourEnd } = computeHourBounds(entries);
  const { slots, totalRows } = layoutSlots(entries, hourStart, hourEnd);
  const hourLabels = Array.from(
    { length: hourEnd - hourStart },
    (_, i) => hourStart + i,
  );

  const relKey = relativeLabelKey(viewDate, today);
  const rel = relKey ? t(`agenda.relative.${relKey}`) : null;

  return (
    <div className="flex flex-col gap-4 p-4 xl:gap-5 xl:p-6">
      <div>
        <Link
          href={`/${locale}/doctor/my-day`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          {t("agenda.backToMyDay")}
        </Link>
      </div>

      <section className="rounded-2xl border border-border bg-card">
        <header className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
              <CalendarIcon className="size-5 text-primary" />
              {t("agenda.title")}
            </h1>
            <div className="mt-1 text-sm text-muted-foreground">
              {rel ? `${rel} · ${fullDateLabel(viewDate)}` : fullDateLabel(viewDate)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setViewDate(today)}
              disabled={isToday}
              className={cn(
                "motion-press inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium transition-colors",
                isToday
                  ? "cursor-default text-muted-foreground opacity-60"
                  : "text-foreground hover:bg-muted",
              )}
            >
              {t("agenda.today")}
            </button>
            <button
              type="button"
              aria-label={t("agenda.prevDay")}
              onClick={() => setViewDate((d) => addDays(d, -1))}
              className="motion-press flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeftIcon className="size-4" />
            </button>
            <button
              type="button"
              aria-label={t("agenda.nextDay")}
              onClick={() => setViewDate((d) => addDays(d, 1))}
              className="motion-press flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRightIcon className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="motion-press inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <PrinterIcon className="size-4" />
              {t("agenda.print")}
            </button>
          </div>
        </header>

        {summary && summary.totalAppointments > 0 ? (
          <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3 text-xs">
            <SummaryChip label={t("summary.total")} value={summary.totalAppointments} />
            <SummaryChip
              label={t("summary.consultations")}
              value={summary.consultations}
              tone="primary"
            />
            <SummaryChip
              label={t("summary.repeats")}
              value={summary.repeats}
              tone="violet"
            />
            <SummaryChip
              label={t("summary.completed")}
              value={summary.completedCount}
              tone="success"
            />
            <SummaryChip
              label={t("summary.dayPlan")}
              value={`${summary.dayPlanPercent}%`}
              tone="success"
            />
          </div>
        ) : null}

        <div className="px-3 py-4 lg:px-5">
          {isLoading ? (
            <div className="space-y-2 px-2 py-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : isError ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              {t("agenda.loadError")}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-16 text-center">
              <div className="text-sm font-medium text-muted-foreground">
                {t("agenda.empty")}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("agenda.emptyHint")}
              </div>
            </div>
          ) : (
            <div
              className="grid gap-x-3"
              style={{
                gridTemplateColumns: "56px 1fr",
                gridTemplateRows: `repeat(${totalRows}, ${PX_PER_SLOT}px)`,
              }}
            >
              {hourLabels.map((h, i) => (
                <div
                  key={`hour-${h}`}
                  className="flex items-start justify-end pt-0.5 text-xs font-medium tabular-nums text-muted-foreground"
                  style={{
                    gridColumn: "1",
                    gridRow: `${i * SLOTS_PER_HOUR + 1} / span ${SLOTS_PER_HOUR}`,
                  }}
                >
                  {String(h).padStart(2, "0")}:00
                </div>
              ))}
              {hourLabels.map((h, i) => (
                <div
                  key={`line-${h}`}
                  className="border-t border-border/60"
                  style={{
                    gridColumn: "2",
                    gridRow: `${i * SLOTS_PER_HOUR + 1}`,
                  }}
                  aria-hidden
                />
              ))}
              {slots.map((slot, i) => {
                if (slot.kind === "gap") {
                  return (
                    <div
                      key={`gap-${i}`}
                      className="rounded-lg bg-muted/15"
                      style={{
                        gridColumn: "2",
                        gridRow: `${slot.rowStart} / span ${slot.rowSpan}`,
                      }}
                      aria-hidden
                    />
                  );
                }
                const e = slot.entry;
                const badge = statusBadge(e);
                const href = e.patientId
                  ? isToday &&
                    e.status !== "done" &&
                    e.status !== "no_show" &&
                    e.status !== "cancelled"
                    ? `/${locale}/doctor/reception`
                    : `/${locale}/doctor/patients/${e.patientId}`
                  : null;
                const card = (
                  <div
                    className={cn(
                      "flex h-full flex-col gap-1 rounded-lg border border-border bg-card p-2.5 text-left transition-colors",
                      e.status === "in_progress" &&
                        "border-success/40 bg-success/[0.04]",
                      e.status === "done" && "opacity-70",
                      e.status === "no_show" && "opacity-70",
                      isPast && e.status !== "in_progress" && "opacity-80",
                      href && "hover:border-primary/30 hover:bg-muted/40",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold tabular-nums text-foreground">
                          {e.startTime}
                        </span>
                        {e.durationMin ? (
                          <span className="text-muted-foreground">
                            · {t("agenda.minutes", { n: e.durationMin })}
                          </span>
                        ) : null}
                      </div>
                      {badge ? (
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            badge.className,
                          )}
                        >
                          {t(`agenda.status.${badge.labelKey}`)}
                        </span>
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {e.patientName ??
                          (e.type === "break"
                            ? t("agenda.type.break")
                            : t("agenda.unnamed"))}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {t(`agenda.type.${TYPE_LABEL_KEY[e.type]}`)}
                      </div>
                    </div>
                  </div>
                );
                return (
                  <div
                    key={e.id}
                    style={{
                      gridColumn: "2",
                      gridRow: `${slot.rowStart} / span ${slot.rowSpan}`,
                    }}
                  >
                    {href ? <Link href={href}>{card}</Link> : card}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SummaryChip({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "primary" | "violet" | "success";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
        tone === "default" && "bg-muted text-muted-foreground",
        tone === "primary" && "bg-primary/10 text-primary",
        tone === "violet" && "bg-violet/10 text-violet",
        tone === "success" && "bg-success/10 text-success",
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums font-semibold">{value}</span>
    </span>
  );
}
