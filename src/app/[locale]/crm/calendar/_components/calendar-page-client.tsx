"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";

import { PageContainer } from "@/components/molecules/page-container";
import { EmptyState } from "@/components/atoms/empty-state";
import { NewAppointmentDialog } from "@/components/appointments/NewAppointmentDialog";
import { CalendarDaysIcon } from "lucide-react";

import { AppointmentDrawer } from "../../appointments/_components/appointment-drawer";
import {
  useActiveDoctors,
  useCabinets,
  useCalendarAppointments,
  useCalendarRealtime,
  useServicesRef,
} from "../_hooks/use-calendar-data";
import { useCalendarFilters } from "../_hooks/use-calendar-filters";
import {
  CalendarToolbar,
  defaultRangeLabel,
} from "./calendar-toolbar";
import { CalendarRightRail } from "./calendar-right-rail";
import { CalendarTiles } from "./calendar-tiles";
import { CalendarLegend } from "./calendar-legend";
import type { PendingReschedule } from "./calendar-view";
import { RescheduleConfirmDialog } from "./reschedule-confirm-dialog";
import { rangeForView } from "./calendar-utils";
import "./calendar.css";

// FullCalendar touches `window` — render only on the client. SSR render would
// otherwise blow up during the initial server pass.
//
// The `loading` callback runs at module scope (no React context), so we can't
// `useTranslations` there directly. A tiny inner client component lets the
// fallback render the localized "Загрузка…" string instead of a hardcoded
// English "Loading…".
function CalendarLoadingFallback() {
  const t = useTranslations("calendar");
  return (
    <div className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground">
      {t("loading")}
    </div>
  );
}

const CalendarView = dynamic(
  () => import("./calendar-view").then((m) => m.CalendarViewInner),
  {
    ssr: false,
    loading: () => <CalendarLoadingFallback />,
  },
);

export function CalendarPageClient() {
  useCalendarRealtime();

  const t = useTranslations("calendar");
  const locale = useLocale();
  const { filters, setFilters } = useCalendarFilters();

  const anchor = React.useMemo(() => parseYmd(filters.date), [filters.date]);
  const range = React.useMemo(
    () => rangeForView(anchor, filters.view),
    [anchor, filters.view],
  );

  const doctorsQ = useActiveDoctors();
  const cabinetsQ = useCabinets();
  const servicesQ = useServicesRef();
  const apptsQ = useCalendarAppointments(range.from, range.to);

  const [drawerId, setDrawerId] = React.useState<string | null>(null);
  const [createSeed, setCreateSeed] = React.useState<
    | { doctorId: string | null; date: Date; time: string | null }
    | null
  >(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  // Phase 12 Wave 3 — drag/drop reschedule pipeline:
  // calendar-view captures the drop, computes the new slot, and hands a
  // PendingReschedule (with its own revert/confirm closures) up to here.
  // The dialog renders at this level so it sits above the calendar grid.
  const [pendingReschedule, setPendingReschedule] =
    React.useState<PendingReschedule | null>(null);

  const onPrev = () => setFilters({ date: shiftDateKey(filters.date, filters.view, -1) });
  const onNext = () => setFilters({ date: shiftDateKey(filters.date, filters.view, +1) });
  const onToday = () => setFilters({ date: todayKey() });

  const rangeLabel = defaultRangeLabel(range.from, range.to, locale);

  const appointmentsRows = apptsQ.data?.rows ?? [];
  const isPartial = apptsQ.data?.partial ?? false;

  // Soft hint shown when the entire visible range has zero appointments
  // (after data has loaded). The grid stays interactive — drag-create still
  // works — but the receptionist gets a clear "no bookings here yet" cue.
  const showAllEmptyHint =
    !apptsQ.isLoading && appointmentsRows.length === 0 && !isPartial;

  return (
    <>
      {/* Desktop-only gate. */}
      <div className="hidden xl:flex xl:h-full xl:min-h-0 xl:flex-col">
        <div className="shrink-0 border-b border-border bg-background px-4 pt-3 pb-2">
          <CalendarTiles
            appointments={appointmentsRows}
            date={filters.date}
          />
        </div>
        <CalendarToolbar
          filters={filters}
          onChange={setFilters}
          onPrev={onPrev}
          onNext={onNext}
          onToday={onToday}
          doctors={doctorsQ.data ?? []}
          cabinets={cabinetsQ.data ?? []}
          services={servicesQ.data ?? []}
          rangeLabel={rangeLabel}
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col">
            {apptsQ.isLoading && !apptsQ.data ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t("loading")}
              </div>
            ) : (
              <div className="relative flex min-h-0 flex-1 flex-col">
                <CalendarView
                  filters={filters}
                  doctors={doctorsQ.data ?? []}
                  cabinets={cabinetsQ.data ?? []}
                  appointments={appointmentsRows}
                  onEventClick={(id) => setDrawerId(id)}
                  onEmptySlotClick={(info) => {
                    setCreateSeed(info);
                    setCreateOpen(true);
                  }}
                  onConfirmReschedule={setPendingReschedule}
                />
                {isPartial ? (
                  <div className="pointer-events-none absolute inset-x-0 top-12 z-20 mx-auto flex justify-center px-4">
                    <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {t("partialRange.title")}
                        </span>
                        <span>{t("partialRange.description")}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => apptsQ.refetch()}
                        className="shrink-0 rounded-md border border-amber-400/60 bg-white/70 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-white dark:bg-amber-950/70 dark:text-amber-100 dark:hover:bg-amber-900"
                      >
                        {t("partialRange.retry")}
                      </button>
                    </div>
                  </div>
                ) : null}
                {showAllEmptyHint ? (
                  <div className="pointer-events-none absolute inset-x-0 top-12 z-20 mx-auto flex justify-center px-4">
                    <div className="pointer-events-auto rounded-lg border border-dashed border-border bg-card/95 px-4 py-2 text-center text-xs text-muted-foreground shadow-sm backdrop-blur">
                      <span className="font-medium text-foreground">
                        {t("emptyRange.title")}
                      </span>
                      <span className="ml-1.5">
                        {t("emptyRange.description")}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
            <CalendarLegend />
          </div>
          <CalendarRightRail
            appointments={appointmentsRows}
            doctors={doctorsQ.data ?? []}
          />
        </div>
      </div>

      {/* Below-desktop fallback. */}
      <div className="flex h-full w-full items-center justify-center p-4 xl:hidden">
        <PageContainer>
          <EmptyState
            icon={<CalendarDaysIcon />}
            title={t("desktopOnlyTitle")}
            description={t("desktopOnlyDescription")}
          />
        </PageContainer>
      </div>

      <AppointmentDrawer
        appointmentId={drawerId}
        onClose={() => setDrawerId(null)}
      />

      <NewAppointmentDialog
        open={createOpen}
        onOpenChange={(v) => {
          setCreateOpen(v);
          if (!v) setCreateSeed(null);
        }}
        initialDoctorId={createSeed?.doctorId ?? null}
        initialDate={createSeed?.date ?? null}
        initialTime={createSeed?.time ?? null}
      />

      <RescheduleConfirmDialog
        pending={pendingReschedule}
        onClose={() => setPendingReschedule(null)}
      />
    </>
  );
}

function parseYmd(k: string): Date {
  const [y, m, d] = k.split("-").map((x) => parseInt(x, 10));
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftDateKey(
  key: string,
  view: "day" | "workWeek" | "week",
  direction: 1 | -1,
): string {
  const d = parseYmd(key);
  const step = view === "day" ? 1 : view === "workWeek" ? 5 : 7;
  d.setDate(d.getDate() + direction * step);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
