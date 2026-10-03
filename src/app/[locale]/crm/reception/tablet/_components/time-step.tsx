"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRightIcon, RefreshCwIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { intlLocale } from "@/lib/format";
import { dayStrip, groupSlots } from "@/lib/reception-tablet/doctor-day";

import { useTabletSlots } from "../_hooks/use-tablet-actions";
import { ServiceChips } from "./service-chips";
import { Caption, ErrorNote, TOUCH, TouchButton } from "./tablet-ui";

function dayParts(day: string, locale: string) {
  const at = new Date(`${day}T12:00:00+05:00`);
  const tag = intlLocale(locale === "uz" ? "uz" : "ru");
  const opts = { timeZone: "Asia/Tashkent" } as const;
  return {
    weekday: new Intl.DateTimeFormat(tag, { ...opts, weekday: "short" }).format(at),
    date: new Intl.DateTimeFormat(tag, { ...opts, day: "numeric" }).format(at),
    month: new Intl.DateTimeFormat(tag, { ...opts, month: "short" }).format(at),
  };
}

export function TimeStep({
  today,
  doctorId,
  day,
  time,
  serviceId,
  onServiceChange,
  onDay,
  onTime,
}: {
  today: string;
  doctorId: string;
  day: string;
  time: string | null;
  serviceId: string | null;
  onServiceChange: (serviceId: string | null) => void;
  onDay: (day: string) => void;
  onTime: (time: string) => void;
}) {
  const t = useTranslations("receptionTablet.time");
  const tHome = useTranslations("receptionTablet.home");
  const locale = useLocale();
  const days = React.useMemo(() => dayStrip(today, 15), [today]);
  const slots = useTabletSlots({ doctorId, day, serviceId });
  const groups = groupSlots(slots.data?.slots ?? []);
  const nextDay = days[days.indexOf(day) + 1] ?? null;

  // Keep the picked day in view when the strip scrolls sideways.
  const stripRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [day]);

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-[28px] font-bold leading-tight text-foreground">{t("title")}</h2>

      <ServiceChips doctorId={doctorId} value={serviceId} onChange={onServiceChange} />

      <div
        ref={stripRef}
        role="radiogroup"
        aria-label={t("title")}
        className="-mx-6 flex snap-x gap-3 overflow-x-auto px-6 pb-2 [scrollbar-width:none]"
      >
        {days.map((d, i) => {
          const p = dayParts(d, locale);
          const active = d === day;
          return (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onDay(d)}
              className={cn(
                TOUCH,
                "motion-press flex h-[5.5rem] w-[5.5rem] shrink-0 snap-start flex-col items-center justify-center rounded-2xl border transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground active:bg-muted",
              )}
            >
              <span
                className={cn(
                  "text-[13px] font-bold uppercase tracking-wide",
                  active ? "text-primary-foreground/85" : "text-muted-foreground",
                )}
              >
                {i === 0 ? t("today") : i === 1 ? t("tomorrow") : p.weekday}
              </span>
              <span className="text-[28px] font-bold leading-none tabular-nums">{p.date}</span>
              <span
                className={cn(
                  "text-[13px] font-medium",
                  active ? "text-primary-foreground/85" : "text-muted-foreground",
                )}
              >
                {p.month}
              </span>
            </button>
          );
        })}
      </div>

      {slots.isLoading ? (
        <SlotSkeleton label={t("loading")} />
      ) : slots.isError ? (
        <ErrorNote
          action={
            <TouchButton tone="outline" onClick={() => void slots.refetch()}>
              <RefreshCwIcon />
              {tHome("retry")}
            </TouchButton>
          }
        >
          {t("error")}
        </ErrorNote>
      ) : (slots.data?.slots.length ?? 0) === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border bg-card/40 px-6 py-10 text-center">
          <p className="text-[17px] text-muted-foreground">{t("none")}</p>
          {nextDay ? (
            <TouchButton tone="outline" size="lg" onClick={() => onDay(nextDay)}>
              {t("nextDay")}
              <ChevronRightIcon />
            </TouchButton>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-5" role="radiogroup" aria-label={t("title")}>
          {(
            [
              ["morning", groups.morning],
              ["afternoon", groups.afternoon],
              ["evening", groups.evening],
            ] as const
          ).map(([key, list]) =>
            list.length === 0 ? null : (
              <section key={key} className="flex flex-col gap-3">
                <Caption>{t(key)}</Caption>
                <div className="grid grid-cols-4 gap-3 sm:grid-cols-5 xl:grid-cols-8">
                  {list.map((s) => {
                    const active = s === time;
                    return (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => onTime(s)}
                        className={cn(
                          TOUCH,
                          "motion-press h-16 rounded-2xl border text-[22px] font-semibold tabular-nums transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-foreground active:bg-muted",
                        )}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </section>
            ),
          )}
          {slots.data?.slotMin ? (
            <p className="text-[15px] text-muted-foreground">
              {t("slotMin", { min: slots.data.slotMin })}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SlotSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label={label}>
      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-5 xl:grid-cols-8">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
