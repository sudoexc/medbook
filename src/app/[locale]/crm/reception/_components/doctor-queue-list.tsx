"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CheckIcon,
  ChevronDownIcon,
  HourglassIcon,
  PlusIcon,
  StethoscopeIcon,
  UserIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { EmptyState } from "@/components/atoms/empty-state";
import { SkeletonRow } from "@/components/atoms/skeleton-row";

import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";
import { compareQueuePriority } from "../../appointments/_hooks/use-appointments-list";
import type { DoctorRef } from "../_hooks/use-reception-live";
import type { DoctorPanelDensity } from "../_hooks/use-panel-prefs";
import { DoctorQueuePanel } from "./doctor-queue-panel";

export interface DoctorQueueListProps {
  doctors: DoctorRef[];
  appointmentsByDoctor: Map<string, AppointmentRow[]>;
  isLoading: boolean;
  onRowClick: (appointmentId: string) => void;
  onAddAppointment?: (doctorId: string) => void;
  density?: DoctorPanelDensity;
  showCabinet?: boolean;
  showNextSlot?: boolean;
  className?: string;
}

type RowState = "in_session" | "awaiting" | "empty";

interface DerivedRow {
  doctor: DoctorRef;
  state: RowState;
  current: AppointmentRow | null;
  next: AppointmentRow | null;
  count: number;
  cabinet: string | null;
}

/**
 * Tabular alternative to {@link DoctorQueueGrid}. Each doctor occupies one
 * row with status, queue count, next slot time and an inline "add" action.
 *
 * Sorting is performed by the parent — the list trusts the caller's order.
 *
 * Clicking a row toggles an inline accordion panel beneath it that lists the
 * doctor's queue and exposes one-click status advances. Only one row is
 * expanded at a time so the page doesn't sprawl.
 */
export function DoctorQueueList({
  doctors,
  appointmentsByDoctor,
  isLoading,
  onRowClick,
  onAddAppointment,
  density = "comfortable",
  showCabinet = true,
  showNextSlot = true,
  className,
}: DoctorQueueListProps) {
  const t = useTranslations("reception.doctorsPanel.list");
  const tStatus = useTranslations("reception.doctorQueue");
  const locale = useLocale();
  const [expandedDoctorId, setExpandedDoctorId] = React.useState<string | null>(
    null,
  );

  const rows = React.useMemo<DerivedRow[]>(() => {
    return doctors.map((doctor) => {
      const items = appointmentsByDoctor.get(doctor.id) ?? [];
      const current =
        items.find((a) => a.queueStatus === "IN_PROGRESS") ?? null;
      const upcoming = items
        .filter(
          (a) => a.queueStatus === "WAITING" || a.queueStatus === "BOOKED",
        )
        .sort((a, b) => {
          // Mirror the panel's sort so the "next" preview matches what the
          // receptionist sees: urgency first, then drag order, then slot time.
          const c = compareQueuePriority(a, b);
          if (c !== 0) return c;
          return new Date(a.date).getTime() - new Date(b.date).getTime();
        });
      const next = upcoming[0] ?? null;
      const cabinet =
        (current ?? next)?.cabinet?.number ?? items[0]?.cabinet?.number ?? null;
      const state: RowState = current
        ? "in_session"
        : upcoming.length > 0
          ? "awaiting"
          : "empty";
      return {
        doctor,
        state,
        current,
        next,
        count: items.filter((a) => a.queueStatus !== "COMPLETED" && a.queueStatus !== "CANCELLED").length,
        cabinet,
      };
    });
  }, [doctors, appointmentsByDoctor]);

  if (isLoading && doctors.length === 0) {
    return (
      <div className={cn("flex flex-col gap-2 rounded-xl border border-border bg-card p-2", className)}>
        {[0, 1, 2, 3, 4].map((i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<StethoscopeIcon />}
        title={tStatus("emptyTitle")}
        description={tStatus("emptyHint")}
      />
    );
  }

  const compact = density === "compact";
  const gridTemplate = gridTemplateColumns(showCabinet, showNextSlot);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
      role="table"
      aria-label={t("doctor")}
    >
      <div
        className={cn(
          "grid items-center gap-3 border-b border-border bg-muted/40 px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground",
          compact ? "py-1.5" : "py-2",
        )}
        style={{ gridTemplateColumns: gridTemplate }}
        role="row"
      >
        <span role="columnheader">{t("doctor")}</span>
        {showCabinet ? <span role="columnheader">{t("cabinet")}</span> : null}
        <span role="columnheader" className="text-center">
          {t("queue")}
        </span>
        {showNextSlot ? (
          <span role="columnheader" className="text-center">
            {t("next")}
          </span>
        ) : null}
        <span role="columnheader">{t("status")}</span>
        {/* Колонка действий — `auto`-трек: в шапке рендерим невидимый клон
            содержимого строки, иначе её auto-ширина (sr-only ≈ 0) не совпадает
            со строками (кнопка+шеврон) и все колонки съезжают. */}
        <span role="columnheader">
          <span className="sr-only">{t("addAppointment")}</span>
          <span
            className="invisible flex h-0 items-center justify-end gap-1.5 overflow-hidden"
            aria-hidden
          >
            {onAddAppointment ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs"
                tabIndex={-1}
              >
                <PlusIcon className="size-3.5" />
                {t("addAppointment")}
              </Button>
            ) : null}
            <ChevronDownIcon className="size-4" />
          </span>
        </span>
      </div>

      <ul className="motion-stagger divide-y divide-border">
        {rows.map(({ doctor, state, count, cabinet, next }) => {
          const spec =
            locale === "uz"
              ? doctor.specializationUz
              : doctor.specializationRu;
          const expanded = expandedDoctorId === doctor.id;
          const items = appointmentsByDoctor.get(doctor.id) ?? [];
          const panelId = `doctor-queue-panel-${doctor.id}`;
          const toggle = () => {
            setExpandedDoctorId((cur) => (cur === doctor.id ? null : doctor.id));
          };
          return (
            <li
              key={doctor.id}
              className={cn(
                "motion-rise-in flex flex-col",
                expanded && "bg-muted/30",
              )}
            >
              <div
                role="row"
                aria-expanded={expanded}
                aria-controls={panelId}
                tabIndex={0}
                onClick={toggle}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle();
                  }
                }}
                className={cn(
                  "grid cursor-pointer items-center gap-3 px-3 transition-colors hover:bg-muted/40",
                  compact ? "py-2" : "py-3",
                )}
                style={{ gridTemplateColumns: gridTemplate }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <AvatarWithStatus
                    name={doctor.nameRu}
                    src={doctor.photoUrl}
                    size={compact ? "sm" : "md"}
                    status={
                      state === "in_session"
                        ? "online"
                        : state === "awaiting"
                          ? "waiting"
                          : null
                    }
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {locale === "uz" ? doctor.nameUz : doctor.nameRu}
                    </div>
                    {spec ? (
                      <div className="truncate text-xs text-muted-foreground">
                        {spec}
                      </div>
                    ) : null}
                  </div>
                </div>

                {showCabinet ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {cabinet ? `№ ${cabinet}` : t("noNext")}
                  </span>
                ) : null}

                <span
                  className="text-center text-sm font-semibold tabular-nums text-foreground"
                  aria-label={t("queue")}
                >
                  {count}
                </span>

                {showNextSlot ? (
                  <span className="text-center text-xs tabular-nums text-muted-foreground">
                    {next
                      ? new Date(next.date).toLocaleTimeString(
                          locale === "uz" ? "uz-UZ" : "ru-RU",
                          { hour: "2-digit", minute: "2-digit" },
                        )
                      : t("noNext")}
                  </span>
                ) : null}

                <StatusPill state={state} t={tStatus} />

                <div className="flex items-center justify-end gap-1.5">
                  {onAddAppointment ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddAppointment(doctor.id);
                      }}
                    >
                      <PlusIcon className="size-3.5" />
                      {t("addAppointment")}
                    </Button>
                  ) : null}
                  <ChevronDownIcon
                    className={cn(
                      "size-4 text-muted-foreground transition-transform duration-200",
                      expanded && "rotate-180",
                    )}
                    aria-hidden
                  />
                </div>
              </div>

              {expanded ? (
                <div id={panelId} className="px-3 pb-3">
                  <DoctorQueuePanel
                    appointments={items}
                    doctorId={doctor.id}
                    onOpenAppointment={onRowClick}
                    onAddAppointment={(id) => onAddAppointment?.(id)}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Inline style (not a Tailwind class) — Tailwind JIT can't see template-string
// classes built at runtime, so they get dropped from the bundle and the grid
// collapses to a single column. We use a real CSS value instead.
function gridTemplateColumns(showCabinet: boolean, showNextSlot: boolean): string {
  // [doctor] [cabinet?] [count] [next?] [status] [action]
  const parts: string[] = ["minmax(180px,2fr)"];
  if (showCabinet) parts.push("90px");
  parts.push("90px");
  if (showNextSlot) parts.push("90px");
  parts.push("140px");
  parts.push("auto");
  return parts.join(" ");
}

function StatusPill({
  state,
  t,
}: {
  state: RowState;
  t: ReturnType<typeof useTranslations>;
}) {
  if (state === "in_session") {
    return (
      <Badge variant="default" className="gap-1 bg-success text-white">
        <CheckIcon className="size-3" />
        {t("statusInSession")}
      </Badge>
    );
  }
  if (state === "awaiting") {
    return (
      <Badge variant="secondary" className="gap-1">
        <HourglassIcon className="size-3" />
        {t("statusAwaiting")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <UserIcon className="size-3" />
      {t("statusEmpty")}
    </Badge>
  );
}
