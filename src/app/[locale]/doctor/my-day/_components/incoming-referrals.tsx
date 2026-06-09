"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRightIcon, Share2Icon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { useIncomingReferrals } from "../_hooks/use-doctor-referrals";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

export function IncomingReferrals() {
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "ru";

  const { data: rows, isLoading } = useIncomingReferrals();

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="px-5 pt-4 pb-3">
        <div className="text-[15px] font-semibold text-foreground">
          Входящие направления
        </div>
        <div className="text-[11px] text-muted-foreground">
          Пациенты, направленные ко мне коллегами
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
              <Skeleton className="h-4 w-14" />
            </li>
          ))
        ) : !rows || rows.length === 0 ? (
          <li className="px-5 py-8 text-center text-sm text-muted-foreground">
            Новых направлений нет
          </li>
        ) : (
          rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/${locale}/doctor/patients/${r.patientId}`}
                aria-label={`${r.patientName}: открыть карту пациента`}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Share2Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {r.patientName}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.fromDoctorName ? `от ${r.fromDoctorName}` : "Направление"}
                    {r.diagnosisCode ? ` · ${r.diagnosisCode}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {formatDate(r.createdAt)}
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
          className="motion-press inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
        >
          Все пациенты
          <ArrowRightIcon className="size-4" />
        </Link>
      </footer>
    </section>
  );
}
