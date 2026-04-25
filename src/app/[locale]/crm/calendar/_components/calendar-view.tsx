"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  BuildingIcon,
  CheckCircle2Icon,
  ClockIcon,
  GlobeIcon,
  PhoneIcon,
  RotateCcwIcon,
  SendIcon,
  type LucideIcon,
} from "lucide-react";

import FullCalendar from "@fullcalendar/react";
import type {
  DateSelectArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
} from "@fullcalendar/core";
import type { ResourceInput, ResourceLabelContentArg } from "@fullcalendar/resource";
import interactionPlugin from "@fullcalendar/interaction";
import resourceTimeGridPlugin from "@fullcalendar/resource-timegrid";
import ruLocale from "@fullcalendar/core/locales/ru";
import uzLocale from "@fullcalendar/core/locales/uz";

import { cn } from "@/lib/utils";
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
  appointments,
  onEventClick,
  onEmptySlotClick,
  onMoved,
}: CalendarViewProps) {
  const t = useTranslations("calendar");
  const tConflict = useTranslations("calendar.conflict");
  const tChip = useTranslations("calendar.chip");
  const locale = useLocale();

  const calendarRef = React.useRef<FullCalendar | null>(null);
  const conflicts = useConflictDetector();

  // Sync view / date with props. FullCalendar's changeView/gotoDate trigger
  // synchronous flushSync internally — calling them straight from an effect
  // during React 19 commit phase throws. Defer to a microtask so the commit
  // finishes first.
  React.useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const api = calendarRef.current?.getApi();
      if (!api) return;
      const key = fcViewKey(filters.view);
      if (api.view.type !== key) api.changeView(key);
      const cur = api.getDate();
      const curKey = toDateKey(cur);
      if (curKey !== filters.date) api.gotoDate(filters.date);
    });
    return () => {
      cancelled = true;
    };
  }, [filters.view, filters.date]);

  const resources = React.useMemo<ResourceInput[]>(() => {
    const selected = filters.doctorIds.length
      ? new Set(filters.doctorIds)
      : null;
    let visible = doctors.filter((d) => (selected ? selected.has(d.id) : true));
    // Resource × day × time turns to mush past ~2 doctors: in a 5/7-day grid
    // every column is ~30px and tiles become illegible. Industry-standard
    // clinical calendars (Doctolib, NexHealth, Cliniko) all show ONE doctor's
    // week at a time. Switch via the doctor tab strip in the toolbar.
    if (filters.view !== "day" && visible.length > 1) {
      visible = visible.slice(0, 1);
    }
    if (visible.length === 0 && filters.view !== "day" && doctors.length > 0) {
      visible = [doctors[0]!];
    }
    return visible.map((d) => ({
      id: d.id,
      title: locale === "uz" ? d.nameUz : d.nameRu,
      eventColor: d.color ?? "#3DD5C0",
      extendedProps: { doctor: d },
    }));
  }, [doctors, filters.doctorIds, filters.view, locale]);

  // Single timestamp so doctor-header "active now" and "late" stay stable.
  const [nowMs] = React.useState(() => Date.now());
  // Today's doctor-level stats to paint the column header pill.
  const doctorStats = React.useMemo(() => {
    const now = nowMs;
    const map = new Map<
      string,
      {
        total: number;
        active: number;
        lateMin: number;
        nextStart: number | null;
      }
    >();
    for (const a of appointments) {
      const doctorId = a.doctor?.id;
      if (!doctorId) continue;
      const start = composeStart(a.date, a.time).getTime();
      const end = start + (a.durationMin || 30) * 60_000;
      const entry =
        map.get(doctorId) ?? { total: 0, active: 0, lateMin: 0, nextStart: null };
      entry.total += 1;
      if (a.status === "IN_PROGRESS") {
        entry.active += 1;
        const late = Math.max(0, Math.round((now - end) / 60_000));
        if (late > entry.lateMin) entry.lateMin = late;
      }
      if (
        (a.status === "BOOKED" || a.status === "WAITING") &&
        start > now &&
        (entry.nextStart === null || start < entry.nextStart)
      ) {
        entry.nextStart = start;
      }
      map.set(doctorId, entry);
    }
    return map;
  }, [appointments, nowMs]);

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

  // Each (resource × day) = one time-grid column. Without a min-width per
  // column, FullCalendar squeezes 35+ columns (7 doctors × 5 days) into the
  // viewport and nothing is readable. Compute the minimum width here and let
  // the host scroll horizontally when it overflows. 110px is the smallest
  // width that keeps date + status chip + truncated patient name legible.
  const visibleDays =
    filters.view === "day" ? 1 : filters.view === "workWeek" ? 5 : 7;
  const minColumnPx = 110;
  const axisGutterPx = 60;
  const minWidthPx =
    Math.max(1, resources.length) * visibleDays * minColumnPx + axisGutterPx;

  return (
    <div
      className="mbk-calendar-host flex min-h-0 flex-1"
      style={{ ["--mbk-cal-min-w" as string]: `${minWidthPx}px` }}
    >
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
        eventContent={(arg) => renderEvent(arg, tChip, locale)}
        resourceLabelContent={(arg) => renderResourceLabel(arg, doctorStats, locale, tChip)}
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

const CHANNEL_ICON: Record<string, LucideIcon> = {
  CALL: PhoneIcon,
  PHONE: PhoneIcon,
  TELEGRAM: SendIcon,
  SITE: GlobeIcon,
  WEB: GlobeIcon,
  WALKIN: BuildingIcon,
  REPEAT: RotateCcwIcon,
};

type ChipT = (key: string, values?: Record<string, string | number>) => string;

function statusChip(status: string, tChip: ChipT): {
  label: string;
  className: string;
  Icon: LucideIcon | null;
} {
  switch (status) {
    case "BOOKED":
      return {
        label: tChip("statusBooked"),
        className: "bg-info/15 text-info",
        Icon: CheckCircle2Icon,
      };
    case "WAITING":
      return {
        label: tChip("statusWaiting"),
        className: "bg-warning/20 text-warning-foreground",
        Icon: ClockIcon,
      };
    case "IN_PROGRESS":
      return {
        label: tChip("statusInProgress"),
        className: "bg-primary/15 text-primary",
        Icon: ClockIcon,
      };
    case "COMPLETED":
      return {
        label: tChip("statusCompleted"),
        className: "bg-success/15 text-success-foreground",
        Icon: CheckCircle2Icon,
      };
    case "NO_SHOW":
      return {
        label: tChip("statusNoShowRisk"),
        className: "bg-destructive/15 text-destructive",
        Icon: AlertTriangleIcon,
      };
    case "CANCELLED":
      return {
        label: tChip("statusCancelled"),
        className: "bg-destructive/15 text-destructive",
        Icon: AlertTriangleIcon,
      };
    default:
      return { label: status, className: "bg-muted text-muted-foreground", Icon: null };
  }
}

function renderEvent(arg: EventContentArg, tChip: ChipT, locale: string) {
  const appt = (arg.event.extendedProps as { appointment?: AppointmentRow })
    .appointment;
  const cabinet = (arg.event.extendedProps as { cabinet?: { number: string } | null })
    .cabinet;
  const time = arg.timeText;
  const status = appt?.status ?? "BOOKED";
  const chip = statusChip(status, tChip);
  const ChannelIcon = appt?.channel ? CHANNEL_ICON[appt.channel] : null;
  const serviceName = appt?.primaryService
    ? locale === "uz"
      ? appt.primaryService.nameUz
      : appt.primaryService.nameRu
    : null;
  return (
    <div className="flex h-full min-w-0 flex-col gap-0.5 overflow-hidden rounded-md px-1.5 py-1 text-[11px] leading-tight">
      <div className="flex items-start justify-between gap-1">
        <span className="truncate tabular-nums text-[10px] font-semibold opacity-80">
          {time}
        </span>
        {ChannelIcon ? (
          <ChannelIcon className="size-3 shrink-0 opacity-70" aria-hidden />
        ) : null}
      </div>
      <span className="truncate text-[12px] font-semibold">
        {arg.event.title || "—"}
      </span>
      {serviceName ? (
        <span className="truncate text-[10px] opacity-75">
          {serviceName}
          {cabinet ? ` · ${tChip("cabinetN", { n: cabinet.number })}` : ""}
        </span>
      ) : cabinet ? (
        <span className="truncate text-[10px] opacity-75">
          {tChip("cabinetN", { n: cabinet.number })}
        </span>
      ) : null}
      <span
        className={cn(
          "mt-0.5 inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
          chip.className,
        )}
      >
        {chip.Icon ? <chip.Icon className="size-3" aria-hidden /> : null}
        {chip.label}
      </span>
    </div>
  );
}

function renderResourceLabel(
  arg: ResourceLabelContentArg,
  stats: Map<
    string,
    { total: number; active: number; lateMin: number; nextStart: number | null }
  >,
  locale: string,
  tChip: ChipT,
) {
  const doctor = (arg.resource.extendedProps as { doctor?: DoctorResource })
    .doctor;
  if (!doctor) {
    return <span className="text-sm">{arg.resource.title}</span>;
  }
  const name = locale === "uz" ? doctor.nameUz : doctor.nameRu;
  const initials = initialsOf(name);
  const color = doctor.color ?? "#3DD5C0";
  const s = stats.get(doctor.id);
  const activeNow = s && s.active > 0;
  const lateMin = s?.lateMin ?? 0;
  // "Free" is the expected default — don't render a pill for it. A reception
  // scanning the column should only see exception signals (in-session, late).
  // Silence = available reads faster than a low-contrast soft-green chip.
  const exceptionPill = activeNow
    ? lateMin > 0
      ? { label: tChip("lateMinutes", { min: lateMin }), cls: "bg-destructive text-destructive-foreground" }
      : { label: tChip("inSession"), cls: "bg-primary text-primary-foreground" }
    : null;
  return (
    <div className="mbk-resource-label flex w-full min-w-0 max-w-full flex-col gap-1 overflow-hidden px-2 py-1.5 text-left">
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ backgroundColor: color }}
          aria-hidden
        >
          {initials}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">
          {name}
        </span>
      </div>
      {exceptionPill && (
        <div className="flex min-w-0 items-center">
          <span
            className={cn(
              "inline-flex max-w-full shrink truncate items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
              exceptionPill.cls,
            )}
          >
            {exceptionPill.label}
          </span>
        </div>
      )}
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
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
