"use client";

import {
  CalendarClockIcon,
  CalendarOffIcon,
  ChevronUpIcon,
  RotateCcwIcon,
  SparklesIcon,
  UserPlusIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { usePatientsFilters } from "../_hooks/patients-context";
import {
  useDoctorPatientSegments,
  type SegmentKey,
} from "../_hooks/use-doctor-patient-segments";

/**
 * "AI-помощник" rail on /doctor/patients.
 *
 * Until the Phase 3b recommendation engine lands, this surfaces REAL
 * actionable cohorts derived from `/api/crm/doctors/me/patient-segments`
 * (the same donut source as SegmentationCard) — no fabricated counts.
 * Clicking an item filters the patient table to that segment. When the
 * doctor has no segmented patients we show a neutral empty state rather
 * than inventing recommendations.
 */

// Segments that represent something the doctor can act on, in priority
// order. `active` is excluded — those patients need no follow-up nudge.
const ACTIONABLE: Array<{
  key: Exclude<SegmentKey, "active">;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}> = [
  {
    key: "dormant",
    label: "Давно не посещали клинику",
    icon: CalendarOffIcon,
    tone: "bg-destructive/10 text-destructive",
  },
  {
    key: "watch",
    label: "Нуждаются в контрольном визите",
    icon: CalendarClockIcon,
    tone: "bg-warning/10 text-warning",
  },
  {
    key: "returned",
    label: "Недавно вернулись",
    icon: RotateCcwIcon,
    tone: "bg-info/10 text-info",
  },
  {
    key: "new",
    label: "Новые пациенты",
    icon: UserPlusIcon,
    tone: "bg-success/10 text-success",
  },
];

export function AiAssistantPanel() {
  const { data, isLoading, isError } = useDoctorPatientSegments();
  const { filters, setTab } = usePatientsFilters();

  const countByKey = new Map<SegmentKey, number>(
    (data?.segments ?? []).map((s) => [s.key, s.count]),
  );
  const items = ACTIONABLE.map((a) => ({
    ...a,
    count: countByKey.get(a.key) ?? 0,
  })).filter((a) => a.count > 0);
  const total = items.reduce((sum, a) => sum + a.count, 0);

  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SparklesIcon className="size-4 text-primary" />
          <span className="text-[15px] font-semibold text-foreground">
            AI-помощник
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Свернуть"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronUpIcon className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-xl bg-primary/5 px-3 py-2.5">
        <span className="text-xs font-semibold text-primary">
          Требуют внимания
        </span>
        {isLoading ? (
          <span className="h-5 w-6 animate-pulse rounded-md bg-primary/20" />
        ) : (
          <span className="inline-flex min-w-[24px] items-center justify-center rounded-md bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
            {total}
          </span>
        )}
      </div>

      {isLoading ? (
        <ul className="mt-3 space-y-1">
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="flex items-center gap-2.5 rounded-lg px-2 py-2"
            >
              <span className="size-7 shrink-0 animate-pulse rounded-md bg-muted" />
              <span className="h-3 flex-1 animate-pulse rounded bg-muted" />
              <span className="h-3 w-4 animate-pulse rounded bg-muted" />
            </li>
          ))}
        </ul>
      ) : isError ? (
        <p className="mt-3 px-2 py-4 text-center text-xs text-destructive">
          Не удалось загрузить подсказки.
        </p>
      ) : items.length === 0 ? (
        <p className="mt-3 px-2 py-4 text-center text-xs text-muted-foreground">
          Сейчас никто не требует внимания. Подсказки появятся, когда у
          пациентов изменятся сегменты.
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {items.map((r) => {
            const Icon = r.icon;
            const isActive = filters.tab === r.key;
            return (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => setTab(isActive ? "all" : r.key)}
                  aria-pressed={isActive}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50",
                    isActive && "bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-md",
                      r.tone,
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span className="flex-1 text-xs text-foreground">
                    {r.label}
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                    {r.count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
