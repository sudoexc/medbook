"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { StarIcon, StethoscopeIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { MoneyText } from "@/components/atoms/money-text";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { buttonVariants } from "@/components/ui/button";

import type { DoctorRow } from "../_hooks/use-doctors-list";
import type { DoctorAgg } from "../_hooks/use-doctors-stats";
import type { PeriodKey } from "../_hooks/use-doctors-filters";

export interface DoctorCardProps {
  doctor: DoctorRow;
  agg: DoctorAgg | null;
  /** period shown in the revenue line */
  period: PeriodKey;
  /** weekly capacity baseline for load computation (appointments per period) */
  capacity: number;
  className?: string;
}

function parseRating(r: DoctorRow["rating"]): number | null {
  if (r === null || r === undefined) return null;
  const n = typeof r === "string" ? Number(r) : Number(r);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Grid tile for a single doctor on `/crm/doctors`. Matches screenshot #5:
 * avatar, name, specialty, rating, today's load, revenue for active period.
 */
export function DoctorCard({
  doctor,
  agg,
  period,
  capacity,
  className,
}: DoctorCardProps) {
  const t = useTranslations("crmDoctors");
  const tPeriod = useTranslations("crmDoctors.period");
  const locale = useLocale();

  const rating = parseRating(doctor.rating);
  const name = locale === "uz" ? doctor.nameUz : doctor.nameRu;
  const spec = locale === "uz" ? doctor.specializationUz : doctor.specializationRu;
  const total = agg?.total ?? 0;
  const revenue = agg?.revenue ?? 0;
  const today = agg?.todayCount ?? 0;
  const loadPct =
    capacity > 0 ? Math.min(100, Math.round((total / capacity) * 100)) : 0;

  return (
    <Link
      href={`/${locale}/crm/doctors/${doctor.id}`}
      className={cn(
        "group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)] transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !doctor.isActive && "opacity-70",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AvatarWithStatus
          src={doctor.photoUrl}
          name={name}
          size="lg"
          status={doctor.isActive ? "online" : "offline"}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
              {name}
            </div>
            {!doctor.isActive ? (
              <Badge variant="muted" className="shrink-0">
                {t("card.inactiveBadge")}
              </Badge>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
            <StethoscopeIcon className="size-3.5 shrink-0" />
            <span className="truncate">{spec}</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs">
            {rating !== null ? (
              <>
                <StarIcon className="size-3.5 fill-[color:var(--warning)] text-[color:var(--warning)]" />
                <span className="font-medium text-foreground">
                  {rating.toFixed(1)}
                </span>
                <span className="text-muted-foreground">
                  · {doctor.reviewCount}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">
                {t("card.ratingEmpty")}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">
            {t("card.loadToday", { count: today })}
          </span>
          <span className="font-medium text-foreground">{today}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">
            {t("card.revenuePeriod", { period: tPeriod(period) })}
          </span>
          <span className="font-medium text-foreground">
            <MoneyText amount={revenue} currency="UZS" />
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
          <span>{t("card.loadPercent")}</span>
          <span>{loadPct}%</span>
        </div>
        <Progress value={loadPct} />
      </div>

      <div
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "mt-1 w-full",
        )}
      >
        {t("openProfile")}
      </div>
    </Link>
  );
}
