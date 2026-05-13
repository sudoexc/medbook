"use client";

import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { MOCK_DOC_TABS } from "../_mocks";

export function DocumentsHeader() {
  const activeKey = "all";

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-foreground">Документы</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Управление медицинскими документами клиники
        </p>
      </div>

      <section className="rounded-2xl border border-border bg-card p-2">
        <div className="flex flex-wrap items-center gap-1">
          {MOCK_DOC_TABS.map((t) => {
            const isActive = t.key === activeKey;
            return (
              <button
                key={t.key}
                type="button"
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 font-semibold text-primary"
                    : "text-foreground hover:bg-muted",
                )}
              >
                <span>{t.label}</span>
                <span
                  className={cn(
                    "inline-flex min-w-[28px] items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                    isActive
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {t.count.toLocaleString("ru-RU").replace(",", " ")}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Ещё
            <ChevronDownIcon className="size-3.5" />
          </button>
        </div>
      </section>
    </>
  );
}
