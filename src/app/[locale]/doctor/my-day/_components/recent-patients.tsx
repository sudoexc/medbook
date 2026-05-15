"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { Skeleton } from "@/components/ui/skeleton";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import {
  useDoctorToday,
  type RecentPatientItem,
} from "../_hooks/use-doctor-today";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

export function RecentPatients() {
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "ru";

  const { data: rows, isLoading } = useDoctorToday<RecentPatientItem[]>(
    (d) => d.recentPatients,
  );

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="px-5 pt-4 pb-3">
        <div className="text-[15px] font-semibold text-foreground">
          Недавние пациенты
        </div>
      </header>

      <ul className="grid grid-cols-2 gap-2 px-5 pb-3 md:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <li
              key={i}
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-3"
            >
              <Skeleton className="size-12 rounded-full" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-16" />
            </li>
          ))
        ) : !rows || rows.length === 0 ? (
          <li className="col-span-full px-5 py-8 text-center text-sm text-muted-foreground">
            Недавних пациентов нет
          </li>
        ) : (
          rows.map((p) => (
            <li key={p.id}>
              <Link
                href={`/${locale}/doctor/patients/${p.id}`}
                aria-label={`Открыть карту: ${p.shortName}`}
                className="flex h-full flex-col items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <AvatarWithStatus
                  src={p.avatarUrl}
                  name={p.shortName}
                  size="lg"
                />
                <div className="text-center">
                  <div className="truncate text-xs font-semibold text-foreground">
                    {p.shortName}
                  </div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {formatDate(p.lastVisitAt)}
                  </div>
                </div>
              </Link>
            </li>
          ))
        )}
      </ul>

      <footer className="border-t border-border px-5 py-3">
        <Link
          href={`/${locale}/doctor/patients`}
          className="motion-press inline-flex w-full items-center justify-center rounded-lg py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
        >
          Все пациенты
        </Link>
      </footer>
    </section>
  );
}
