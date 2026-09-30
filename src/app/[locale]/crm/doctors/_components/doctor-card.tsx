"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Tv } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { MoneyText } from "@/components/atoms/money-text";
import { buttonVariants } from "@/components/ui/button";
import { NewAppointmentDialog } from "@/components/appointments/NewAppointmentDialog";

import type { DoctorRow } from "../_hooks/use-doctors-list";
import type { DoctorToday } from "../_hooks/use-doctors-stats";

/** Live status from the server: on the table, in shift and free, off shift. */
export type DoctorStatus = DoctorToday["status"];

export interface DoctorCardProps {
  doctor: DoctorRow;
  /**
   * Today from the schedule and the real visits (DR-08); null for a
   * deactivated doctor or while loading.
   */
  today: DoctorToday | null;
  todayLoading?: boolean;
  /** Cabinet number (e.g. "101") assigned to this doctor */
  cabinet: string;
  className?: string;
}

/** Pastel avatar palette — picked deterministically by hashing the doctor id. */
const AVATAR_PALETTE = [
  "bg-violet-100 text-violet-700",
  "bg-emerald-100 text-emerald-700",
  "bg-rose-100 text-rose-700",
  "bg-amber-100 text-amber-700",
  "bg-sky-100 text-sky-700",
  "bg-pink-100 text-pink-700",
] as const;

function pickPalette(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]!;
}

function loadBarColor(pct: number): string {
  if (pct < 30) return "bg-destructive/70";
  if (pct < 60) return "bg-warning";
  if (pct < 80) return "bg-success/70";
  return "bg-success";
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 3) {
    return `${parts[0]} ${parts[1]?.[0]?.toUpperCase()}. ${parts[2]?.[0]?.toUpperCase()}.`;
  }
  if (parts.length === 2) {
    return `${parts[0]} ${parts[1]?.[0]?.toUpperCase()}.`;
  }
  return name;
}

/**
 * Doctor card for /crm/doctors — Image #17 layout.
 * Header: colored avatar + (name / spec / cabinet) · status pill row.
 * Body: load% bar · revenue / visits / nearest slot, all of today.
 * Footer: Расписание (outline) + Записать (primary) buttons.
 *
 * Every number is today's, from the schedule and the real visits (audit
 * DR-08): no fixed 10-visit capacity, no «Обед» made up from a gap, no
 * month's revenue under «Выручка сегодня».
 */
export function DoctorCard({
  doctor,
  today,
  todayLoading = false,
  cabinet,
  className,
}: DoctorCardProps) {
  const locale = useLocale();
  const t = useTranslations("crmDoctors.card");
  const name = locale === "uz" ? doctor.nameUz : doctor.nameRu;
  const spec = locale === "uz" ? doctor.specializationUz : doctor.specializationRu;
  const [bookOpen, setBookOpen] = React.useState(false);

  const status: DoctorStatus = today?.status ?? "off";
  const loadPct = today?.loadPct ?? null;

  const initials = deriveInitials(name);
  const palette = pickPalette(doctor.id);

  const pill = (() => {
    // A deactivated doctor must never masquerade as «Свободен» — in this
    // clinic most cards are deactivated and only one doctor is bookable.
    if (!doctor.isActive)
      return {
        label: t("statusInactive"),
        bg: "bg-destructive/10",
        fg: "text-destructive",
        dot: "bg-destructive",
      };
    if (status === "busy")
      return {
        label: t("statusBusy"),
        bg: "bg-success/15",
        fg: "text-success",
        dot: "bg-success",
      };
    if (status === "free")
      return {
        label: t("statusFree"),
        bg: "bg-info/10",
        fg: "text-info",
        dot: "bg-info",
      };
    return {
      label: t("statusOff"),
      bg: "bg-muted",
      fg: "text-muted-foreground",
      dot: "bg-muted-foreground/60",
    };
  })();

  // Without today's data (loading, failed, deactivated) the rows show a
  // dash, never a zero that reads as a real count.
  const dash = <span className="text-muted-foreground">—</span>;

  return (
    <div
      className={cn(
        "flex min-h-[360px] w-[280px] shrink-0 flex-col rounded-2xl border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {doctor.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={doctor.photoUrl}
            alt={name}
            className="size-12 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            className={cn(
              "inline-flex size-12 shrink-0 items-center justify-center rounded-full text-[14px] font-bold",
              palette,
            )}
            aria-hidden
          >
            {initials}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-foreground">
            {shortName(name)}
          </div>
          <div className="truncate text-[12px] text-muted-foreground">
            {spec}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {t("cabinetText", { cabinet })}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            pill.bg,
            pill.fg,
          )}
        >
          <span className={cn("size-1.5 rounded-full", pill.dot)} aria-hidden />
          {pill.label}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{t("loadTodayLabel")}</span>
        {loadPct !== null ? (
          <span className="tabular-nums font-bold text-foreground">{loadPct}%</span>
        ) : today && !todayLoading ? (
          // No working time today by the schedule: no percentage is honest.
          <span className="font-medium text-muted-foreground">
            {today.workingMinutes === 0 ? t("notWorkingToday") : t("noData")}
          </span>
        ) : (
          dash
        )}
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {loadPct !== null ? (
          <div
            className={cn("h-full rounded-full transition-all", loadBarColor(loadPct))}
            style={{ width: `${Math.min(100, loadPct)}%` }}
          />
        ) : null}
      </div>

      <dl className="mt-3 space-y-1.5 text-[12px]">
        <Row label={t("revenueToday")}>
          {today ? (
            <MoneyText
              amount={today.revenueToday}
              currency="UZS"
              className="text-[12px] font-semibold"
            />
          ) : (
            dash
          )}
        </Row>
        <Row label={t("appointmentsCount")}>
          {today ? <span className="tabular-nums">{today.booked}</span> : dash}
        </Row>
        <Row label={t("nearSlot")}>
          {today?.nextFree ? (
            <span className="tabular-nums text-foreground">{today.nextFree}</span>
          ) : today ? (
            <span className="text-muted-foreground">{t("noSlots")}</span>
          ) : (
            dash
          )}
        </Row>
      </dl>

      <div className="mt-auto flex gap-2 pt-4">
        <Link
          href={`/${locale}/crm/doctors/${doctor.id}`}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "motion-press h-9 flex-1 text-[12px]",
          )}
        >
          {t("schedule")}
        </Link>
        {/* New bookings only for active doctors — the server rejects the
            create anyway (doctor_inactive), no point offering a dead end. */}
        {doctor.isActive && (
          <button
            type="button"
            onClick={() => setBookOpen(true)}
            className={cn(
              buttonVariants({ variant: "default", size: "sm" }),
              "motion-press h-9 flex-1 text-[12px]",
            )}
          >
            {t("book")}
          </button>
        )}
        {doctor.tvToken && (
          <button
            type="button"
            title={t("tvLink")}
            aria-label={t("tvLink")}
            onClick={async () => {
              const url = `${window.location.origin}/tv/d/${doctor.tvToken}`;
              try {
                await navigator.clipboard.writeText(url);
                toast.success(t("tvLinkCopied"));
              } catch {
                toast.error(url); // clipboard blocked — surface the URL itself
              }
            }}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "motion-press h-9 w-9 shrink-0 px-0",
            )}
          >
            <Tv className="h-4 w-4" />
          </button>
        )}
      </div>
      <NewAppointmentDialog
        open={bookOpen}
        onOpenChange={setBookOpen}
        initialDoctorId={doctor.id}
      />
    </div>
  );
}

// dt/dd (not spans): rendered directly inside the card's <dl>, and axe's
// `definition-list` rule only allows a <div> child there when it wraps a
// proper dt+dd group. Same layout classes, so visuals are untouched.
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums text-foreground">{children}</dd>
    </div>
  );
}
