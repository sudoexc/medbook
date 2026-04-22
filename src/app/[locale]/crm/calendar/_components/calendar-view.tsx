"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import FullCalendar from "@fullcalendar/react";
import type {
  DateSelectArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
} from "@fullcalendar/core";
import type { ResourceInput } from "@fullcalendar/resource";
import interactionPlugin from "@fullcalendar/interaction";
import resourceTimeGridPlugin from "@fullcalendar/resource-timegrid";
import ruLocale from "@fullcalendar/core/locales/ru";
import uzLocale from "@fullcalendar/core/locales/uz";

import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";
import type {
  CabinetRef,
  DoctorResource,
} from "../_hooks/use-calendar-data";
import type {
  CalendarFilters,
  CalendarView,
} from "../_hooks/use-calendar-filters";
import { useConflictDetector } from "../_hooks/use-conflict-detector";
import {
  colorFromId,
  composeStart,
  fcViewKey,
  hhmm,
  STATUS_COLORS,
} from "./calendar-utils";

export interface CalendarViewProps {
  filters: CalendarFilters;
  doctors: DoctorResource[];
  cabinets: CabinetRef[];
  appointments: AppointmentRow[];
  onEventClick: (id: string) => void;
  onEmptySlotClick: (info: {
    doctorId: string | null;
    date: Date;
    time: string;
  }) => void;
  onMoved?: () => void;
}

export function CalendarViewInner({
  filters,
  doctors,
  cabinets,
  appointments,
  onEventClick,
  onEmptySlotClick,
  onMoved,
}: CalendarViewProps) {
  const t = useTranslations("calendar");
  const tConflict = useTranslations("calendar.conflict");
  const locale = useLocale();

  const calendarRef = React.useRef<FullCalendar | null>(null);
  const conflicts = useConflictDetector();

  // Sync view / date with props.
  React.useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    const key = fcViewKey(filters.view);
    if (api.view.type !== key) api.changeView(key);
    const cur = api.getDate();
    const curKey = toDateKey(cur);
    if (curKey !== filters.date) api.gotoDate(filters.date);
  }, [filters.view, filters.date]);

  const resources = React.useMemo<ResourceInput[]>(() => {
    const selected = filters.doctorIds.length
      ? new Set(filters.doctorIds)
      : null;
    return doctors
      .filter((d) => (selected ? selected.has(d.id) : true))
      .map((d) => ({
        id: d.id,
        title: locale === "uz" ? d.nameUz : d.nameRu,
        eventColor: d.color ?? "#3DD5C0",
      }));
  }, [doctors, filters.doctorIds, locale]);

  const cabinetById = React.useMemo(() => {
    const map = new Map<string, CabinetRef>();
    for (const c of cabinets) map.set(c.id, c);
    return map;
  }, [cabinets]);

  const events = React.useMemo<EventInput[]>(() => {
    const cabinetFilter = filters.cabinetIds.length
      ? new Set(filters.cabinetIds)
      : null;
    const serviceFilter = filters.serviceIds.length
      ? new Set(filters.serviceIds)
      : null;
    const out: EventInput[] = [];
    for (const a of appointments) {
      if (!a.doctor?.id) continue;
      if (cabinetFilter) {
        if (!a.cabinet?.id || !cabinetFilter.has(a.cabinet.id)) continue;
      }
      if (serviceFilter) {
        const match =
          (a.primaryService && serviceFilter.has(a.primaryService.id)) ||
          a.services.some((s) => serviceFilter.has(s.serviceId));
        if (!match) continue;
      }
      const start = composeStart(a.date, a.time);
      const end = new Date(start.getTime() + (a.durationMin || 30) * 60_000);

      const byCabinet = filters.cabinetOverlay && a.cabinet?.id;
      const palette = STATUS_COLORS[a.status] ?? STATUS_COLORS.BOOKED;
      const color = byCabinet
        ? colorFromId(a.cabinet!.id)
        : (a.doctor.color ?? palette.border);
      const bg = byCabinet ? `${color}22` : palette.bg;
      const border = byCabinet ? color : palette.border;

      out.push({
        id: a.id,
        resourceId: a.doctor.id,
        start,
        end,
        title: a.patient?.fullName ?? t("event.untitled"),
        backgroundColor: bg,
        borderColor: border,
        textColor: palette.text,
        extendedProps: {
          appointment: a,
          cabinet: a.cabinet,
        },
      });
    }
    return out;
  }, [
    appointments,
    filters.cabinetIds,
    filters.serviceIds,
    filters.cabinetOverlay,
    t,
  ]);

  const handleEventDrop = async (info: EventDropArg) => {
    const id = info.event.id;
    const newStart = info.event.start;
    const newResourceId = info.event.getResources()[0]?.id;
    if (!newStart) {
      info.revert();
      return;
    }
    const newTime = hhmm(newStart);
    const newDateIso = new Date(newStart);
    newDateIso.setHours(0, 0, 0, 0);

    conflicts.mutate({
      id,
      patch: {
        date: newDateIso.toISOString(),
        time: newTime,
        doctorId: newResourceId,
      },
      onConflict: (c) => {
        info.revert();
        const reasonLabel = tConflictSafe(
          tConflict,
          c.reason,
          c.until ?? "",
        );
        toast.error(reasonLabel);
      },
      onSuccess: () => {
        toast.success(t("toast.moved"));
        onMoved?.();
      },
    });
  };

  const handleEventResize = async (info: {
    event: { id: string; start: Date | null; end: Date | null };
    revert: () => void;
  }) => {
    const id = info.event.id;
    if (!info.event.start || !info.event.end) {
      info.revert();
      return;
    }
    const duration = Math.max(
      5,
      Math.round(
        (info.event.end.getTime() - info.event.start.getTime()) / 60_000,
      ),
    );
    conflicts.mutate({
      id,
      patch: { durationMin: duration },
      onConflict: (c) => {
        info.revert();
        toast.error(tConflictSafe(tConflict, c.reason, c.until ?? ""));
      },
      onSuccess: () => toast.success(t("toast.moved")),
    });
  };

  const handleSelect = (arg: DateSelectArg) => {
    const resourceId =
      (arg as unknown as { resource?: { id: string } }).resource?.id ?? null;
    const start = arg.start;
    onEmptySlotClick({
      doctorId: resourceId,
      date: start,
      time: hhmm(start),
    });
    calendarRef.current?.getApi().unselect();
  };

  const handleEventClick = (arg: EventClickArg) => {
    onEventClick(arg.event.id);
  };

  return (
    <div className="mbk-calendar-host flex min-h-0 flex-1 overflow-hidden">
      <FullCalendar
        ref={calendarRef}
        plugins={[resourceTimeGridPlugin, interactionPlugin]}
        schedulerLicenseKey="GPL-My-Project-Is-Open-Source"
        initialView={fcViewKey(filters.view)}
        initialDate={filters.date}
        headerToolbar={false}
        height="100%"
        nowIndicator
        allDaySlot={false}
        slotMinTime="08:00:00"
        slotMaxTime="21:00:00"
        slotDuration="00:15:00"
        slotLabelInterval="01:00:00"
        firstDay={1}
        locales={LOCALES}
        locale={locale === "uz" ? "uz" : "ru"}
        resources={resources}
        events={events}
        eventContent={renderEvent}
        editable
        eventStartEditable
        eventDurationEditable
        eventResizableFromStart={false}
        selectable
        selectMirror
        select={handleSelect}
        eventClick={handleEventClick}
        eventDrop={handleEventDrop}
        eventResize={handleEventResize as never}
        views={{
          resourceTimeGridDay: {
            type: "resourceTimeGrid",
            duration: { days: 1 },
          },
          resourceTimeGridWorkWeek: {
            type: "resourceTimeGrid",
            duration: { days: 5 },
          },
          resourceTimeGridWeek: {
            type: "resourceTimeGrid",
            duration: { days: 7 },
          },
        }}
      />
    </div>
  );
}

function renderEvent(arg: EventContentArg) {
  const appt = (arg.event.extendedProps as { appointment?: AppointmentRow })
    .appointment;
  const cabinet = (arg.event.extendedProps as { cabinet?: { number: string } | null })
    .cabinet;
  const time = arg.timeText;
  return (
    <div className="flex h-full min-w-0 flex-col gap-0.5 overflow-hidden p-1 text-[11px] leading-tight">
      <span className="truncate font-medium">
        {arg.event.title || "—"}
      </span>
      <span className="flex items-center gap-1 text-[10px] opacity-80">
        <span className="tabular-nums">{time}</span>
        {cabinet ? <span>· №{cabinet.number}</span> : null}
      </span>
      {appt?.primaryService ? (
        <span className="truncate text-[10px] opacity-70">
          {appt.primaryService.nameRu}
        </span>
      ) : null}
    </div>
  );
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function tConflictSafe(
  tConflict: (k: string, vals?: Record<string, string>) => string,
  reason: string,
  until: string,
): string {
  try {
    return (tConflict as unknown as (
      k: string,
      v?: Record<string, string>,
    ) => string)(reason, { until });
  } catch {
    return reason;
  }
}

// FullCalendar ships ru + uz locale bundles — import them directly.
const LOCALES = [ruLocale, uzLocale];

export default CalendarViewInner;

// Re-export the view enum for convenience.
export type { CalendarView };
