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
import { rangeForView } from "./calendar-utils";
import "./calendar.css";

// FullCalendar touches `window` — render only on the client. SSR render would
// otherwise blow up during the initial server pass.
const CalendarView = dynamic(
  () => import("./calendar-view").then((m) => m.CalendarViewInner),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    ),
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

  const onPrev = () => setFilters({ date: shiftDateKey(filters.date, filters.view, -1) });
  const onNext = () => setFilters({ date: shiftDateKey(filters.date, filters.view, +1) });
  const onToday = () => setFilters({ date: todayKey() });

  const rangeLabel = defaultRangeLabel(range.from, range.to, locale);

  return (
    <>
      {/* Desktop-only gate. */}
      <div className="hidden xl:flex xl:h-full xl:min-h-0 xl:flex-col">
        <div className="shrink-0 border-b border-border bg-background px-4 pt-3 pb-2">
          <CalendarTiles appointments={apptsQ.data ?? []} />
        </div>
        <CalendarToolbar
          filters={filters}
          onChange={setFilters}
          onPrev={onPrev}
          onNext={onNext}
          onToday={onToday}
          onCreateClick={() => {
            setCreateSeed({ doctorId: null, date: anchor, time: null });
            setCreateOpen(true);
          }}
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
              <CalendarView
                filters={filters}
                doctors={doctorsQ.data ?? []}
                cabinets={cabinetsQ.data ?? []}
                appointments={apptsQ.data ?? []}
                onEventClick={(id) => setDrawerId(id)}
                onEmptySlotClick={(info) => {
                  setCreateSeed(info);
                  setCreateOpen(true);
                }}
              />
            )}
            <CalendarLegend />
          </div>
          <CalendarRightRail
            appointments={apptsQ.data ?? []}
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
  const step = view === "day" ? 1 : 7;
  d.setDate(d.getDate() + direction * step);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
