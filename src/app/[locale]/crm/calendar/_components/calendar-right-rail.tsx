"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";

import { MoneyText } from "@/components/atoms/money-text";
import { Progress } from "@/components/ui/progress";

import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";
import type { DoctorResource } from "../_hooks/use-calendar-data";
import { STATUS_COLORS } from "./calendar-utils";

export interface CalendarRightRailProps {
  appointments: AppointmentRow[];
  doctors: DoctorResource[];
}

export function CalendarRightRail({
  appointments,
  doctors,
}: CalendarRightRailProps) {
  const t = useTranslations("calendar.rail");
  const tLegend = useTranslations("calendar.legend");
  const locale = useLocale();

  const totals = React.useMemo(() => {
    let total = 0;
    let completed = 0;
    let revenue = 0;
    const byDoctor = new Map<string, number>();
    for (const a of appointments) {
      total += 1;
      if (a.status === "COMPLETED") {
        completed += 1;
        revenue += a.priceFinal ?? 0;
      }
      const minutes = a.durationMin || 30;
      byDoctor.set(
        a.doctor.id,
        (byDoctor.get(a.doctor.id) ?? 0) + minutes,
      );
    }
    return { total, completed, revenue, byDoctor };
  }, [appointments]);

  // Occupancy denominator: assume 8h per doctor/day × days in range.
  const days = React.useMemo(() => {
    if (!appointments.length) return 1;
    const set = new Set<string>();
    for (const a of appointments) {
      set.add(a.date.slice(0, 10));
    }
    return set.size || 1;
  }, [appointments]);

  const capacity = 8 * 60 * days; // mins per doctor

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-card/30 p-3">
      <section className="rounded-lg border border-border bg-card/60 p-3">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("stats")}
        </h3>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">
              {t("totalCount")}
            </dt>
            <dd className="text-lg font-semibold tabular-nums">
              {totals.total}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {t("completedCount")}
            </dt>
            <dd className="text-lg font-semibold tabular-nums">
              {totals.completed}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">
              {t("revenueTotal")}
            </dt>
            <dd className="text-lg font-semibold">
              <MoneyText amount={totals.revenue} currency="UZS" />
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-border bg-card/60 p-3">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("occupancy")}
        </h3>
        {doctors.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noData")}</p>
        ) : (
          <ul className="space-y-2">
            {doctors.map((d) => {
              const mins = totals.byDoctor.get(d.id) ?? 0;
              const pct = Math.min(100, Math.round((mins / capacity) * 100));
              return (
                <li key={d.id} className="grid gap-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 truncate">
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: d.color ?? "#3DD5C0" }}
                      />
                      <span className="truncate">
                        {locale === "uz" ? d.nameUz : d.nameRu}
                      </span>
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {pct}%
                    </span>
                  </div>
                  <Progress value={pct} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card/60 p-3">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {tLegend("title")}
        </h3>
        <ul className="grid gap-1 text-xs">
          {(Object.keys(STATUS_COLORS) as (keyof typeof STATUS_COLORS)[]).map(
            (s) => (
              <li key={s} className="flex items-center gap-2">
                <span
                  className="inline-block size-2.5 rounded"
                  style={{
                    backgroundColor: STATUS_COLORS[s].bg,
                    borderLeft: `3px solid ${STATUS_COLORS[s].border}`,
                  }}
                />
                <span>{s}</span>
              </li>
            ),
          )}
        </ul>
      </section>
    </aside>
  );
}
