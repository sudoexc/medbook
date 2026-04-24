"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangleIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { MoneyText } from "@/components/atoms/money-text";
import { buttonVariants } from "@/components/ui/button";

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

/**
 * Load bar color by percentage — matches legend on docs/6 - Врачи.png:
 * 0-30% red (idle), 30-60% amber, 60-80% light green, 80-100% green.
 */
function loadColor(pct: number): string {
  if (pct < 30) return "bg-destructive";
  if (pct < 60) return "bg-[color:var(--warning,#f59e0b)]";
  if (pct < 80) return "bg-[color:var(--success,#10b981)]/70";
  return "bg-[color:var(--success,#10b981)]";
}

function useStatusLabel() {
  const t = useTranslations("crmDoctors.card");
  return (status: DoctorStatus, idleFor: string | null | undefined) => {
    if (status === "busy") return t("statusBusy");
    if (status === "idle")
      return `${t("statusIdle")}${idleFor ? ` ${idleFor}` : ""}`;
    return t("statusFree");
  };
}

/**
 * Doctor carousel tile for the /crm/doctors dashboard.
 * Header: avatar · status pill · Каб. N
 * Body: load% with colored bar · Доход сегодня / Записей / Ср. время приёма
 * Footer: Ближайшие окна (free slots chips) · Расписание / Записать actions
 */
export function DoctorCard({
  doctor,
  agg,
  dayCapacity,
  status,
  idleFor,
  cabinet,
  freeSlots,
  avgMinutes,
  className,
}: DoctorCardProps) {
  const locale = useLocale();
  const t = useTranslations("crmDoctors.card");
  const statusLabel = useStatusLabel();
  const name = locale === "uz" ? doctor.nameUz : doctor.nameRu;
  const spec = locale === "uz" ? doctor.specializationUz : doctor.specializationRu;

  const today = agg?.todayCount ?? 0;
  const revenue = agg?.revenue ?? 0;
  const loadPct =
    dayCapacity > 0 ? Math.min(100, Math.round((today / dayCapacity) * 100)) : 0;

  // Doctor initials (fallback short form — "И. Ибрагимов")
  const parts = name.trim().split(/\s+/);
  const shortName =
    parts.length >= 2
      ? `${parts[0]} ${parts[1]?.[0]?.toUpperCase()}. ${parts[2]?.[0]?.toUpperCase() ?? ""}.`.trim()
      : name;

  const pill = (() => {
    if (status === "busy")
      return {
        bg: "bg-[color:var(--success,#10b981)]/15",
        fg: "text-[color:var(--success,#10b981)]",
        dot: "bg-[color:var(--success,#10b981)]",
      };
    if (status === "idle")
      return {
        bg: "bg-destructive/10",
        fg: "text-destructive",
        dot: "bg-destructive",
      };
    return {
      bg: "bg-muted",
      fg: "text-muted-foreground",
      dot: "bg-muted-foreground/60",
    };
  })();

  const accentBorder = status === "idle" ? "border-destructive/40" : "border-border";
  const accentBg = status === "idle" ? "bg-destructive/[0.02]" : "bg-card";

  return (
    <div
      className={cn(
        "flex min-h-[320px] w-[260px] shrink-0 flex-col rounded-2xl border bg-card p-3 shadow-[0_1px_2px_rgba(15,23,42,.04)]",
        accentBorder,
        accentBg,
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AvatarWithStatus
          src={doctor.photoUrl}
          name={name}
          size="lg"
          status={doctor.isActive ? "online" : "offline"}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-1">
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                pill.bg,
                pill.fg,
              )}
            >
              <span className={cn("size-1.5 rounded-full", pill.dot)} aria-hidden />
              {statusLabel(status, idleFor)}
            </span>
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {t("cabinetN", { cabinet })}
            </span>
          </div>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-foreground">
              {shortName}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {spec}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{t("loadTodayLabel")}</span>
        <span className="tabular-nums font-bold text-foreground">
          {loadPct}%
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", loadColor(loadPct))}
          style={{ width: `${loadPct}%` }}
        />
      </div>

      <dl className="mt-3 space-y-1 text-[11px]">
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
      </dl>

      <div className="mt-3">
        <div className="mb-1 text-[11px] text-muted-foreground">
          {t("nearSlots")}
        </div>
        {status === "idle" ? (
          <div className="inline-flex w-full items-center justify-between gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] font-semibold text-destructive">
            <span className="inline-flex items-center gap-1">
              <AlertTriangleIcon className="size-3" />
              {t("hasFreeSlots")}
            </span>
            <span className="tabular-nums">
              {idleFor ?? t("now")}
            </span>
          </div>
        ) : freeSlots.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">{t("noSlots")}</div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {freeSlots.slice(0, 3).map((s) => (
              <span
                key={s}
                className={cn(
                  "inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                  "bg-[color:var(--success,#10b981)]/10 text-[color:var(--success,#10b981)]",
                )}
              >
                {s}
              </span>
            ))}
            {freeSlots.length > 3 ? (
              <span className="inline-flex items-center justify-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                +{freeSlots.length - 3}
              </span>
            ) : null}
          </div>
        )}
      </div>

      <div className="mt-auto grid grid-cols-2 gap-1.5 pt-3">
        <Link
          href={`/${locale}/crm/doctors/${doctor.id}`}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "h-8 text-[12px]",
            status === "idle" &&
              "border-destructive/40 text-destructive hover:bg-destructive/10",
          )}
        >
          {status === "idle" ? t("fillSlots") : t("schedule")}
        </Link>
        <button
          type="button"
          className={cn(
            buttonVariants({ variant: "default", size: "sm" }),
            "h-8 text-[12px]",
            status === "idle" &&
              "bg-destructive text-destructive-foreground hover:bg-destructive/90",
          )}
        >
          {status === "idle" ? t("redirect") : t("book")}
        </button>
      </div>
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
