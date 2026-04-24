"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CalendarClockIcon,
  ChevronRightIcon,
  PhoneIcon,
  SparklesIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { MoneyText } from "@/components/atoms/money-text";

import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";
import type { DoctorResource } from "../_hooks/use-calendar-data";
import { composeStart } from "./calendar-utils";

export interface CalendarRightRailProps {
  appointments: AppointmentRow[];
  doctors: DoctorResource[];
}

type Tone = "primary" | "warning" | "danger" | "success" | "info";

const TONE_CLASS: Record<Tone, { icon: string; border: string; chip: string }> = {
  primary: {
    icon: "bg-primary/10 text-primary",
    border: "border-l-primary",
    chip: "bg-primary/10 text-primary",
  },
  warning: {
    icon: "bg-[color:var(--warning,#f59e0b)]/15 text-[color:var(--warning,#f59e0b)]",
    border: "border-l-[color:var(--warning,#f59e0b)]",
    chip: "bg-[color:var(--warning,#f59e0b)]/15 text-[color:var(--warning,#f59e0b)]",
  },
  danger: {
    icon: "bg-destructive/10 text-destructive",
    border: "border-l-destructive",
    chip: "bg-destructive/10 text-destructive",
  },
  success: {
    icon: "bg-[color:var(--success,#10b981)]/15 text-[color:var(--success,#10b981)]",
    border: "border-l-[color:var(--success,#10b981)]",
    chip: "bg-[color:var(--success,#10b981)]/15 text-[color:var(--success,#10b981)]",
  },
  info: {
    icon: "bg-[color:var(--info,#3b82f6)]/15 text-[color:var(--info,#3b82f6)]",
    border: "border-l-[color:var(--info,#3b82f6)]",
    chip: "bg-[color:var(--info,#3b82f6)]/15 text-[color:var(--info,#3b82f6)]",
  },
};

/**
 * Right rail for the calendar — docs/3 - Календарь записей (2).png.
 *
 * Sections:
 *  - AI-рекомендации (3 colored action cards)
 *  - Неподтверждённые записи (list)
 *  - Свободные слоты сегодня (per-doctor chips)
 *  - Статистика на день (2×2 grid)
 */
export function CalendarRightRail({
  appointments,
  doctors,
}: CalendarRightRailProps) {
  const locale = useLocale();
  const t = useTranslations("calendar.rail");
  const [now] = React.useState(() => Date.now());

  const stats = React.useMemo(() => {
    let total = 0;
    let completed = 0;
    let unconfirmed = 0;
    let noShowRisk = 0;
    let revenue = 0;
    for (const a of appointments) {
      total += 1;
      if (a.status === "COMPLETED") {
        completed += 1;
        revenue += a.priceFinal ?? 0;
      }
      if (a.status === "BOOKED") unconfirmed += 1;
      const start = composeStart(a.date, a.time).getTime();
      if (a.status === "NO_SHOW") noShowRisk += 1;
      else if (
        (a.status === "BOOKED" || a.status === "WAITING") &&
        now - start > 15 * 60_000
      ) {
        noShowRisk += 1;
      }
    }
    const conversionPct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, unconfirmed, noShowRisk, revenue, conversionPct };
  }, [appointments, now]);

  const unconfirmedList = React.useMemo(() => {
    return appointments
      .filter((a) => a.status === "BOOKED")
      .slice()
      .sort(
        (a, b) =>
          composeStart(a.date, a.time).getTime() -
          composeStart(b.date, b.time).getTime(),
      )
      .slice(0, 4);
  }, [appointments]);

  const freeSlotsByDoctor = React.useMemo(() => {
    const byDoctor = new Map<string, number>();
    for (const a of appointments) {
      byDoctor.set(
        a.doctor.id,
        (byDoctor.get(a.doctor.id) ?? 0) + (a.durationMin || 30),
      );
    }
    // Rough heuristic — assume 11h workday, 30-min slots.
    const dayCapMin = 11 * 60;
    return doctors.slice(0, 5).map((d) => {
      const scheduled = byDoctor.get(d.id) ?? 0;
      const free = Math.max(0, Math.floor((dayCapMin - scheduled) / 30));
      return {
        id: d.id,
        name: locale === "uz" ? d.nameUz : d.nameRu,
        color: d.color ?? "#3DD5C0",
        free,
      };
    });
  }, [appointments, doctors, locale]);

  const recommendations: Array<{
    tone: Tone;
    icon: LucideIcon;
    title: string;
    body: string;
    cta: string;
  }> = [
    {
      tone: "danger",
      icon: AlertTriangleIcon,
      title: t("recReschedule"),
      body:
        stats.noShowRisk > 0
          ? t("recRescheduleBody", { count: stats.noShowRisk })
          : t("recRescheduleEmpty"),
      cta: t("recRescheduleCta"),
    },
    {
      tone: "primary",
      icon: CalendarClockIcon,
      title: t("recFillSlot"),
      body: t("recFillSlotBody"),
      cta: t("recFillSlotCta"),
    },
    {
      tone: "warning",
      icon: PhoneIcon,
      title: t("recCallback"),
      body:
        stats.unconfirmed > 0
          ? t("recCallbackBody", { count: stats.unconfirmed })
          : t("recCallbackEmpty"),
      cta: t("recCallbackCta"),
    },
  ];

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-card/30 p-3">
      {/* AI recommendations */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <SparklesIcon className="size-3.5" />
            {t("aiTitle")}
          </h3>
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-primary/10 px-1 text-[10px] font-bold text-primary">
            {recommendations.length}
          </span>
        </div>
        <ul className="space-y-2">
          {recommendations.map((r) => {
            const tone = TONE_CLASS[r.tone];
            const Icon = r.icon;
            return (
              <li
                key={r.title}
                className={cn(
                  "rounded-xl border border-border bg-card p-2.5 border-l-[3px]",
                  tone.border,
                )}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      "inline-flex size-7 shrink-0 items-center justify-center rounded-lg",
                      tone.icon,
                    )}
                    aria-hidden
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-foreground">
                      {r.title}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {r.body}
                    </p>
                    <button
                      type="button"
                      className={cn(
                        "mt-1.5 inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                        tone.chip,
                      )}
                    >
                      {r.cta}
                      <ArrowRightIcon className="size-3" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Unconfirmed */}
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("unconfirmed")}
        </h3>
        {unconfirmedList.length === 0 ? (
          <p className="rounded-xl border border-border bg-card p-2.5 text-[12px] text-muted-foreground">
            {t("unconfirmedEmpty")}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {unconfirmedList.map((a) => {
              const start = composeStart(a.date, a.time);
              const hh = String(start.getHours()).padStart(2, "0");
              const mm = String(start.getMinutes()).padStart(2, "0");
              return (
                <li
                  key={a.id}
                  className="flex items-center gap-2 rounded-xl border border-border bg-card p-2 text-[12px]"
                >
                  <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <UserRoundIcon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-foreground">
                      {a.patient?.fullName ?? "—"}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {hh}:{mm}
                      {(() => {
                        const svcName =
                          locale === "uz"
                            ? a.primaryService?.nameUz
                            : a.primaryService?.nameRu;
                        return svcName ? ` · ${svcName}` : "";
                      })()}
                    </p>
                  </div>
                  <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Free slots */}
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("freeSlotsToday")}
        </h3>
        {freeSlotsByDoctor.length === 0 ? (
          <p className="rounded-xl border border-border bg-card p-2.5 text-[12px] text-muted-foreground">
            {t("noActiveDoctors")}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {freeSlotsByDoctor.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1.5 text-[12px]"
              >
                <span
                  className="inline-block size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: d.color }}
                  aria-hidden
                />
                <span className="truncate font-medium text-foreground">
                  {d.name}
                </span>
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {t("slotsCount", { count: d.free })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Daily stats */}
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("dailyStats")}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <StatCell label={t("statAppointments")} value={stats.total} />
          <StatCell label={t("statConversion")} value={`${stats.conversionPct}%`} />
          <StatCell
            label={t("statRevenue")}
            value={<MoneyText amount={stats.revenue} currency="UZS" />}
            span
          />
        </div>
      </section>
    </aside>
  );
}

function StatCell({
  label,
  value,
  span,
}: {
  label: string;
  value: React.ReactNode;
  span?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-2.5",
        span && "col-span-2",
      )}
    >
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-[15px] font-bold tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}
