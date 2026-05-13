"use client";

import * as React from "react";
import { PlusIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { MOCK_TASKS } from "../_mocks";

export function TodayTasks() {
  const [done, setDone] = React.useState<Record<string, boolean>>({});
  const toggle = (id: string) =>
    setDone((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="px-5 pt-4 pb-3">
        <div className="text-[15px] font-semibold text-foreground">
          Задачи на сегодня
        </div>
      </header>

      <ul className="space-y-1 px-3 pb-2">
        {MOCK_TASKS.map((task) => {
          const checked = done[task.id] ?? false;
          return (
            <li key={task.id}>
              <button
                type="button"
                onClick={() => toggle(task.id)}
                className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50"
              >
                <span
                  aria-checked={checked}
                  role="checkbox"
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                    checked
                      ? "border-primary bg-primary"
                      : "border-border bg-card group-hover:border-primary/50",
                  )}
                >
                  {checked ? (
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
                    checked
                      ? "text-muted-foreground line-through"
                      : "text-foreground",
                  )}
                >
                  {task.title}
                </span>
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary tabular-nums">
                  {task.count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <footer className="border-t border-border px-5 py-3">
        <button
          type="button"
          className="motion-press inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
        >
          Добавить задачу
          <PlusIcon className="size-4" />
        </button>
      </footer>
    </section>
  );
}
