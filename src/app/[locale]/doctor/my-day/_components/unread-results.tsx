"use client";

import { ArrowRightIcon, FileTextIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useDoctorToday,
  type UnreadResultItem,
} from "../_hooks/use-doctor-today";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

const FLAG_TONE: Record<string, string> = {
  CRITICAL: "bg-destructive/15 text-destructive",
  HIGH: "bg-warning/15 text-warning",
  LOW: "bg-warning/15 text-warning",
  NORMAL: "bg-success/15 text-success",
};

export function UnreadResults() {
  const { data: rows, isLoading } = useDoctorToday<UnreadResultItem[]>(
    (d) => d.unreadResults,
  );

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="px-5 pt-4 pb-3">
        <div className="text-[15px] font-semibold text-foreground">
          Непрочитанные результаты
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
            Новых результатов нет
          </li>
        ) : (
          rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/50"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
                  <FileTextIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {r.testName}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.patientShort}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {formatDate(r.receivedAt)}
                  </div>
                  {r.flag && r.flag !== "NORMAL" ? (
                    <span
                      className={cn(
                        "mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        FLAG_TONE[r.flag] ?? "bg-muted text-muted-foreground",
                      )}
                    >
                      {r.flag === "CRITICAL"
                        ? "критич."
                        : r.flag === "HIGH"
                          ? "выше"
                          : "ниже"}
                    </span>
                  ) : r.isNew ? (
                    <span className="mt-1 inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                      новый
                    </span>
                  ) : null}
                </div>
              </button>
            </li>
          ))
        )}
      </ul>

      <footer className="border-t border-border px-5 py-3">
        <button
          type="button"
          className="motion-press inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
        >
          Показать все результаты
          <ArrowRightIcon className="size-4" />
        </button>
      </footer>
    </section>
  );
}
