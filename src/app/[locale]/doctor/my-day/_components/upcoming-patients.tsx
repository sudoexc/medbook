"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRightIcon, PhoneIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";

import {
  useDoctorToday,
  type DoctorToday,
  type UpcomingPatient,
} from "../_hooks/use-doctor-today";

type MyDayTranslate = ReturnType<typeof useTranslations<"doctor.myDay">>;

const TYPE_LABEL_KEY: Record<UpcomingPatient["type"], string> = {
  consultation: "type.consultation",
  repeat: "type.repeat",
};

/**
 * Render "через 5 мин", "через 1 ч 15 мин", or fall back to the slot
 * duration when the appointment is too far away to be operationally
 * useful as a relative timer.
 *
 * Threshold = 4h: past that, the absolute HH:MM above already gives the
 * doctor everything they need; what they want under the time block is a
 * sense of *imminence*, not a ticker that reads «через 6 ч».
 */
function formatRelative(
  startAtMs: number,
  nowMs: number,
  durationMin: number,
  t: MyDayTranslate,
): string {
  const diffMin = Math.round((startAtMs - nowMs) / 60000);
  if (diffMin < -1) return t("upcoming.durationMin", { n: durationMin });
  if (diffMin <= 0) return t("upcoming.now");
  if (diffMin > 240) return t("upcoming.durationMin", { n: durationMin });
  if (diffMin < 60) return t("upcoming.inMinutes", { n: diffMin });
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  return mins > 0
    ? t("upcoming.inHoursMinutes", { h: hours, m: mins })
    : t("upcoming.inHours", { h: hours });
}

/**
 * Tick once a minute so relative-time labels stay honest. Using the
 * minute as the clock instead of seconds keeps the render rate down
 * (10 rows × 1 update/min vs 10 × 60), and the user can't tell the
 * difference because the label only changes on minute boundaries.
 */
export function useMinuteClock(): number {
  const [now, setNow] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    // Sync to the next minute boundary so all rows update in lockstep.
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    let interval: ReturnType<typeof setInterval> | undefined;
    const align = setTimeout(() => {
      setNow(Date.now());
      interval = setInterval(() => setNow(Date.now()), 60_000);
    }, msToNextMinute);
    return () => {
      clearTimeout(align);
      if (interval) clearInterval(interval);
    };
  }, []);
  return now;
}

type Slice = { upcoming: UpcomingPatient[]; total: number };

export function UpcomingPatients() {
  const t = useTranslations("doctor.myDay");
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "ru";

  const { data, isLoading } = useDoctorToday<Slice>((d: DoctorToday) => ({
    upcoming: d.upcoming,
    total: d.upcomingTotal,
  }));
  const upcoming = data?.upcoming ?? [];
  const total = data?.total ?? 0;
  const hidden = Math.max(0, total - upcoming.length);

  const nowMs = useMinuteClock();

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="px-5 pt-4 pb-3">
        <div className="text-[15px] font-semibold text-foreground">
          {t("upcoming.title")}
        </div>
      </header>

      <ul className="flex-1 divide-y divide-border/60 px-2">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-3 py-2.5">
              <div className="w-12 space-y-1">
                <Skeleton className="h-3.5 w-10" />
                <Skeleton className="h-3 w-8" />
              </div>
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </li>
          ))
        ) : upcoming.length === 0 ? (
          <li className="px-5 py-10 text-center text-sm text-muted-foreground">
            {t("upcoming.empty")}
          </li>
        ) : (
          upcoming.map((p) => {
            const startAtMs = new Date(p.startAt).getTime();
            const relative = formatRelative(startAtMs, nowMs, p.durationMin, t);
            const imminent =
              startAtMs - nowMs <= 15 * 60_000 && startAtMs - nowMs >= 0;
            const patientHref = `/${locale}/doctor/patients/${p.patientId}`;

            return (
              <li
                key={p.appointmentId}
                className="group relative flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50 focus-within:bg-muted/50"
              >
                {/*
                  Stretched-link pattern: the Link spans the whole row
                  (absolute inset-0) so anywhere on the row activates it,
                  while the phone <a> below sits at z-10 above so its own
                  click doesn't navigate to the patient card.
                */}
                <Link
                  href={patientHref}
                  aria-label={t("upcoming.openCardAria", { name: p.shortName })}
                  className="absolute inset-0 z-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="relative w-12 shrink-0">
                  <div className="text-sm font-semibold tabular-nums text-foreground">
                    {p.startTime}
                  </div>
                  <div
                    className={cn(
                      "text-[11px] tabular-nums",
                      imminent
                        ? "font-semibold text-primary"
                        : "text-muted-foreground",
                    )}
                  >
                    {relative}
                  </div>
                </div>
                <AvatarWithStatus
                  src={p.avatarUrl}
                  name={p.shortName}
                  size="sm"
                />
                <div className="relative min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {p.shortName}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {t(TYPE_LABEL_KEY[p.type])}
                  </div>
                </div>
                {p.phone ? (
                  <a
                    href={`tel:${p.phone}`}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={t("upcoming.callAria", { name: p.shortName })}
                    className="motion-press relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <PhoneIcon className="size-4" />
                  </a>
                ) : (
                  <span
                    aria-hidden
                    className="relative z-10 flex h-8 w-8 items-center justify-center text-muted-foreground/40"
                    title={t("upcoming.noPhone")}
                  >
                    <PhoneIcon className="size-4" />
                  </span>
                )}
                {/* Affordance that the whole row opens the patient card. */}
                <ChevronRightIcon
                  aria-hidden
                  className="relative size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground"
                />
              </li>
            );
          })
        )}
      </ul>

      <footer className="border-t border-border px-5 py-3">
        <Link
          href={`/${locale}/doctor/reception`}
          className="motion-press inline-flex w-full items-center justify-center gap-2 rounded-lg py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
        >
          {t("upcoming.showAll")}
          {total > 0 ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold">
              {total}
            </span>
          ) : null}
          {hidden > 0 ? (
            <span className="text-[11px] font-normal text-muted-foreground">
              {t("upcoming.moreHidden", { count: hidden })}
            </span>
          ) : null}
        </Link>
      </footer>
    </section>
  );
}
