"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronRightIcon, FileEditIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  useDoctorToday,
  type DraftItem,
} from "../_hooks/use-doctor-today";

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function DraftConclusions() {
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "ru";

  const { data: rows, isLoading } = useDoctorToday<DraftItem[]>(
    (d) => d.drafts,
  );

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="px-5 pt-4 pb-3">
        <div className="text-[15px] font-semibold text-foreground">
          Черновики заключений
        </div>
      </header>

      <ul className="grid grid-cols-1 gap-2 px-5 pb-3 md:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <li
              key={i}
              className="flex flex-col gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2.5"
            >
              <div className="flex items-start gap-2">
                <Skeleton className="size-7 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <Skeleton className="h-3 w-1/3" />
            </li>
          ))
        ) : !rows || rows.length === 0 ? (
          <li className="col-span-full px-5 py-8 text-center text-sm text-muted-foreground">
            Черновиков нет
          </li>
        ) : (
          rows.map((d) => (
            <li key={d.id}>
              <Link
                href={`/${locale}/doctor/conclusions/${d.id}`}
                aria-label={`Продолжить: ${d.title} — ${d.patientShort}`}
                className="flex flex-col gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2.5 transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <FileEditIcon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-foreground">
                      {d.title}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {d.patientShort}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {formatTime(d.updatedAt)}
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary">
                    Продолжить
                    <ChevronRightIcon className="size-3" />
                  </span>
                </div>
              </Link>
            </li>
          ))
        )}
      </ul>

      <footer className="border-t border-border px-5 py-3">
        <Link
          href={`/${locale}/doctor/conclusions?status=draft`}
          className="motion-press inline-flex w-full items-center justify-center rounded-lg py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
        >
          Все черновики
        </Link>
      </footer>
    </section>
  );
}
