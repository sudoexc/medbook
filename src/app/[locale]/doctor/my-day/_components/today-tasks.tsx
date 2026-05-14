"use client";

import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useDoctorToday,
  type ActionItem,
} from "../_hooks/use-doctor-today";

export function TodayTasks() {
  const { data: actionItems, isLoading } = useDoctorToday<ActionItem[]>(
    (d) => d.actionItems,
  );

  const hasAnyWork =
    actionItems && actionItems.some((a) => a.count > 0);

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="px-5 pt-4 pb-3">
        <div className="text-[15px] font-semibold text-foreground">
          Задачи на сегодня
        </div>
      </header>

      <ul className="space-y-1 px-3 pb-2">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-2 py-2">
              <Skeleton className="size-5 rounded-full" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-5 w-6 rounded-full" />
            </li>
          ))
        ) : !actionItems || actionItems.length === 0 ? (
          <li className="px-5 py-8 text-center text-sm text-muted-foreground">
            Задач нет
          </li>
        ) : !hasAnyWork ? (
          <li className="px-5 py-8 text-center text-sm text-muted-foreground">
            Всё сделано на сегодня
          </li>
        ) : (
          actionItems.map((item) => {
            const done = item.count === 0;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      done
                        ? "border-success bg-success"
                        : "border-border bg-card group-hover:border-primary/50",
                    )}
                  >
                    {done ? (
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        fill="none"
                        aria-hidden
                      >
                        <path
                          d="M2 5.5L4 7.5L8 3"
                          stroke="white"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "flex-1 truncate text-sm",
                      done
                        ? "text-muted-foreground line-through"
                        : "text-foreground",
                    )}
                  >
                    {item.title}
                  </span>
                  <span
                    className={cn(
                      "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                      done
                        ? "bg-muted text-muted-foreground"
                        : "bg-primary/10 text-primary",
                    )}
                  >
                    {item.count}
                  </span>
                </Link>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
