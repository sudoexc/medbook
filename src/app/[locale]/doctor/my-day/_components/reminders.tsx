"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { BellIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  useDoctorToday,
  type ReminderItem,
} from "../_hooks/use-doctor-today";

function formatRemindAt(iso: string, now: Date): {
  rel: string;
  abs: string;
} {
  const target = new Date(iso);
  const diffMs = target.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  const absDays = Math.round(Math.abs(diffMs) / (24 * 60 * 60_000));
  const abs = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(target);

  if (Math.abs(diffMin) < 60) {
    if (diffMin <= 0) return { rel: "сейчас", abs };
    return { rel: `через ${diffMin} мин`, abs };
  }
  const diffH = Math.round(diffMs / (60 * 60_000));
  if (Math.abs(diffH) < 24) {
    if (diffH < 0) return { rel: `${-diffH} ч назад`, abs };
    return { rel: `через ${diffH} ч`, abs };
  }
  if (diffMs < 0) return { rel: `${absDays} дн назад`, abs };
  return { rel: `через ${absDays} дн`, abs };
}

export function Reminders() {
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "ru";

  const { data: rows, isLoading } = useDoctorToday<ReminderItem[]>(
    (d) => d.reminders,
  );
  const now = new Date();

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="px-5 pt-4 pb-3">
        <div className="text-[15px] font-semibold text-foreground">
          Напоминания
        </div>
      </header>

      <ul className="space-y-1 px-3 pb-2">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-2 py-2.5">
              <Skeleton className="size-9 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-4 w-16" />
            </li>
          ))
        ) : !rows || rows.length === 0 ? (
          <li className="px-5 py-8 text-center text-sm text-muted-foreground">
            Активных напоминаний нет
          </li>
        ) : (
          rows.map((r) => {
            const { rel, abs } = formatRemindAt(r.remindAt, now);
            // Patient-bound reminders deep-link to the patient card so the
            // doctor can take action in context; unbound reminders fall back
            // to the central notifications inbox where the reminder lives.
            const href = r.patientId
              ? `/${locale}/doctor/patients/${r.patientId}`
              : `/${locale}/doctor/notifications`;

            return (
              <li key={r.id}>
                <Link
                  href={href}
                  aria-label={`Напоминание: ${r.title}`}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <BellIcon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {r.title}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.patientShort ?? "без пациента"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs font-medium text-foreground">
                      {rel}
                    </div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {abs}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })
        )}
      </ul>

      <footer className="border-t border-border px-5 py-3">
        <Link
          href={`/${locale}/doctor/notifications`}
          className="motion-press inline-flex w-full items-center justify-center rounded-lg py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
        >
          Все напоминания
        </Link>
      </footer>
    </section>
  );
}
