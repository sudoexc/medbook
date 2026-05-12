"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { MoneyText } from "@/components/atoms/money-text";
import { buttonVariants } from "@/components/ui/button";
import { NewAppointmentDialog } from "@/components/appointments/NewAppointmentDialog";

import type { DoctorRow } from "../_hooks/use-doctors-list";
import type { DoctorAgg } from "../_hooks/use-doctors-stats";

export type DoctorStatus = "busy" | "idle" | "free";

export interface DoctorCardProps {
  doctor: DoctorRow;
  agg: DoctorAgg | null;
  /** Daily capacity baseline for the load bar (appointments / day) */
  dayCapacity: number;
  /** Derived status for the badge above the name */
  status: DoctorStatus;
  /** Human-readable idle interval ("2ч 10м") if status === "idle" */
  idleFor?: string | null;
  /** Ordinal cabinet number assigned to this doctor */
  cabinet: number;
  /** Upcoming free slots today (HH:MM) */
  freeSlots: string[];
  /** Average minutes per appointment */
  avgMinutes: number;
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
 * Body: load% bar · revenue / visits / avg time / nearest slot.
 * Footer: Расписание (outline) + Записать (primary) buttons.
 */
export function DoctorCard({
  doctor,
  agg,
  dayCapacity,
  status,
  cabinet,
  freeSlots,
  avgMinutes,
  className,
}: DoctorCardProps) {
  const locale = useLocale();
  const t = useTranslations("crmDoctors.card");
  const name = locale === "uz" ? doctor.nameUz : doctor.nameRu;
  const spec = locale === "uz" ? doctor.specializationUz : doctor.specializationRu;
  const [bookOpen, setBookOpen] = React.useState(false);

  const today = agg?.todayCount ?? 0;
  const revenue = agg?.revenue ?? 0;
  const loadPct =
    dayCapacity > 0 ? Math.min(100, Math.round((today / dayCapacity) * 100)) : 0;

  const initials = deriveInitials(name);
  const palette = pickPalette(doctor.id);

  const pill = (() => {
    if (status === "busy")
      return {
        label: t("statusBusy"),
        bg: "bg-success/15",
        fg: "text-success",
        dot: "bg-success",
      };
    if (status === "idle")
      return {
        label: t("statusLunch"),
        bg: "bg-warning/15",
        fg: "text-[color:var(--warning-foreground)]",
        dot: "bg-warning",
      };
    return {
      label: t("statusFree"),
      bg: "bg-muted",
      fg: "text-muted-foreground",
      dot: "bg-muted-foreground/60",
    };
  })();

  const nearestSlot = freeSlots[0] ?? null;

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
        <span className="tabular-nums font-bold text-foreground">{loadPct}%</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", loadBarColor(loadPct))}
          style={{ width: `${loadPct}%` }}
        />
      </div>

      <dl className="mt-3 space-y-1.5 text-[12px]">
        <Row label={t("revenueToday")}>
          <MoneyText
            amount={revenue}
            currency="UZS"
            className="text-[12px] font-semibold"
          />
        </Row>
        <Row label={t("appointmentsCount")}>
          <span className="tabular-nums">{today}</span>
        </Row>
        <Row label={t("avgTime")}>
          <span className="tabular-nums">{t("minSuffix", { min: avgMinutes })}</span>
        </Row>
        <Row label={t("nearSlot")}>
          {nearestSlot ? (
            <span className="tabular-nums text-foreground">{nearestSlot}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Row>
      </dl>

      <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
        <Link
          href={`/${locale}/crm/doctors/${doctor.id}`}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "motion-press h-9 text-[12px]",
          )}
        >
          {t("schedule")}
        </Link>
        <button
          type="button"
          onClick={() => setBookOpen(true)}
          className={cn(
            buttonVariants({ variant: "default", size: "sm" }),
            "motion-press h-9 text-[12px]",
          )}
        >
          {t("book")}
        </button>
      </div>
      <NewAppointmentDialog
        open={bookOpen}
        onOpenChange={setBookOpen}
        initialDoctorId={doctor.id}
      />
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{children}</span>
    </div>
  );
}
