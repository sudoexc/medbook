"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ActivityIcon,
  ArrowUpRightIcon,
  ClockIcon,
  StethoscopeIcon,
  Users2Icon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { isLiveLane } from "@/lib/queue-ordering";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";

import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";
import { compareQueuePriority } from "../../appointments/_hooks/use-appointments-list";

export type ReceptionListMode = "queue" | "in_progress";

export interface ReceptionListDrawerProps {
  mode: ReceptionListMode | null;
  rows: AppointmentRow[];
  onOpenChange: (open: boolean) => void;
  onRowClick: (appointmentId: string) => void;
}

const QUEUE_STATUSES = new Set(["WAITING", "BOOKED", "CONFIRMED"]);

/** A rendered group: the "queue" mode splits into the two lanes, "in_progress" stays flat. */
interface DrawerSection {
  key: string;
  /** Subsection header; null renders the rows without one. */
  title: string | null;
  rows: AppointmentRow[];
}

/**
 * Side-drawer that opens off the KPI strip for the two live-data tiles:
 *  - "queue"        — patients waiting / scheduled but not yet in cabinet
 *  - "in_progress"  — appointments currently happening
 *
 * Unlike `/crm/appointments?bucket=...` (which yanks the receptionist out of
 * their dashboard into a full table), this slides in over the dashboard and
 * lets them tap a row to open the existing AppointmentDrawer for triage —
 * keeping the live grid and call-center widget visible behind the overlay.
 */
export function ReceptionListDrawer({
  mode,
  rows,
  onOpenChange,
  onRowClick,
}: ReceptionListDrawerProps) {
  const t = useTranslations("reception.listDrawer");
  // Lane subsection titles are shared with the queue column.
  const tQueue = useTranslations("reception.queueColumn");
  const locale = useLocale();

  const { sections, total } = React.useMemo(() => {
    if (!mode) return { sections: [] as DrawerSection[], total: 0 };
    if (mode === "in_progress") {
      const list = rows
        .filter((r) => (r.queueStatus ?? r.status) === "IN_PROGRESS")
        .sort((a, b) => {
          const sa = a.startedAt ? new Date(a.startedAt).getTime() : 0;
          const sb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
          return sb - sa;
        });
      return {
        sections: [{ key: "in_progress", title: null, rows: list }],
        total: list.length,
      };
    }
    // Two lanes (docs/TZ-two-lanes.md), membership by channel: live FIFO
    // first (queue position = what the receptionist announces), bookings
    // after, on their own calendar axis.
    const queue = rows.filter((r) =>
      QUEUE_STATUSES.has(r.queueStatus ?? r.status),
    );
    // Same WAITING rule as the panel — a non-WAITING walk-in is off-path.
    const live = queue
      .filter((r) => isLiveLane(r) && (r.queueStatus ?? r.status) === "WAITING")
      .sort(compareQueuePriority);
    const booked = queue
      .filter((r) => !isLiveLane(r))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const sections: DrawerSection[] = [];
    if (live.length > 0)
      sections.push({
        key: "live",
        title: tQueue("subsectionLive"),
        rows: live,
      });
    if (booked.length > 0)
      sections.push({
        key: "booked",
        title: tQueue("subsectionBooked"),
        rows: booked,
      });
    return { sections, total: live.length + booked.length };
  }, [mode, rows, tQueue]);

  const fullListHref =
    mode === "queue"
      ? "/crm/appointments?dateMode=today&bucket=waiting"
      : "/crm/appointments?dateMode=today&bucket=in_progress";

  const isOpen = mode != null;
  const HeaderIcon = mode === "in_progress" ? ActivityIcon : Users2Icon;
  const tone =
    mode === "in_progress"
      ? "bg-success/12 text-success"
      : "bg-warning/15 text-warning-text";

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[440px]"
      >
        <SheetHeader className="border-b border-border p-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className={cn(
                "mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
                tone,
              )}
            >
              <HeaderIcon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <SheetTitle className="text-base font-semibold">
                  {mode === "in_progress"
                    ? t("inProgressTitle")
                    : t("queueTitle")}
                </SheetTitle>
                <Badge
                  variant="secondary"
                  className="h-5 min-w-5 justify-center px-1.5 text-[11px] tabular-nums"
                >
                  {total}
                </Badge>
              </div>
              <SheetDescription className="mt-0.5 text-xs text-muted-foreground">
                {mode === "in_progress"
                  ? t("inProgressSubtitle")
                  : t("queueSubtitle")}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {total === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
              <span className="inline-flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <HeaderIcon className="size-5" />
              </span>
              <p className="text-sm font-medium text-foreground">
                {mode === "in_progress"
                  ? t("inProgressEmpty")
                  : t("queueEmpty")}
              </p>
              <p className="text-xs text-muted-foreground">
                {mode === "in_progress"
                  ? t("inProgressEmptyHint")
                  : t("queueEmptyHint")}
              </p>
            </div>
          ) : (
            sections.map((section) => (
              <section
                key={section.key}
                className="border-b border-border last:border-b-0"
              >
                {section.title ? (
                  <header className="flex items-center justify-between bg-muted/30 px-4 py-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      {section.title}
                    </span>
                    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
                      {section.rows.length}
                    </span>
                  </header>
                ) : null}
                <ul className="divide-y divide-border">
                  {section.rows.map((row, i) => (
                    <li key={row.id}>
                      <DrawerRow
                        index={i + 1}
                        row={row}
                        mode={mode!}
                        locale={locale}
                        onClick={() => {
                          onRowClick(row.id);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>

        <div className="border-t border-border bg-muted/30 px-4 py-3">
          <Link
            href={fullListHref}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
          >
            {t("openFullList")}
            <ArrowUpRightIcon className="size-3.5" />
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DrawerRow({
  index,
  row,
  mode,
  locale,
  onClick,
}: {
  index: number;
  row: AppointmentRow;
  mode: ReceptionListMode;
  locale: string;
  onClick: () => void;
}) {
  const t = useTranslations("reception.listDrawer");
  const time = formatTime(new Date(row.date), locale);
  const doctorName = locale === "uz" ? row.doctor.nameUz : row.doctor.nameRu;
  const service =
    (locale === "uz"
      ? row.primaryService?.nameUz
      : row.primaryService?.nameRu) ?? null;
  const cabinet = row.cabinet?.number ?? null;

  const meta = mode === "in_progress" ? computeProgress(row) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
        "hover:bg-muted/60 focus-visible:bg-muted/70 focus-visible:outline-none",
      )}
    >
      <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground tabular-nums">
        {index}
      </span>
      <AvatarWithStatus
        name={row.patient.fullName}
        src={row.patient.photoUrl}
        size="sm"
        status={mode === "in_progress" ? "busy" : "online"}
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {row.patient.fullName}
          </span>
          <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
            {time}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1 truncate">
            <StethoscopeIcon className="size-3 shrink-0" />
            <span className="truncate">{doctorName}</span>
          </span>
          {service ? (
            <span className="min-w-0 truncate">· {service}</span>
          ) : null}
          {cabinet ? (
            <span className="shrink-0">· {t("cabinetShort", { num: cabinet })}</span>
          ) : null}
        </div>
        {meta ? (
          <div className="mt-1.5 flex items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-md bg-success/10 px-1.5 py-0.5 font-medium text-success">
              <ClockIcon className="size-3" />
              {t("elapsed", { min: meta.elapsedMin })}
            </span>
            {meta.remainingMin != null ? (
              <span
                className={cn(
                  "tabular-nums",
                  meta.remainingMin <= 0
                    ? "text-destructive font-semibold"
                    : "text-muted-foreground",
                )}
              >
                {meta.remainingMin <= 0
                  ? t("overdue", { min: -meta.remainingMin })
                  : t("remaining", { min: meta.remainingMin })}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function computeProgress(row: AppointmentRow): {
  elapsedMin: number;
  remainingMin: number | null;
} | null {
  if (!row.startedAt) return null;
  const started = new Date(row.startedAt).getTime();
  const elapsed = Math.max(0, Math.round((Date.now() - started) / 60_000));
  const planned = row.durationMin > 0 ? row.durationMin : null;
  const remaining = planned != null ? planned - elapsed : null;
  return { elapsedMin: elapsed, remainingMin: remaining };
}

function formatTime(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export default ReceptionListDrawer;
