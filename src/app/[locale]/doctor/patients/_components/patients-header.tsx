"use client";

import { ChevronDownIcon, SlidersHorizontalIcon, UploadIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { MOCK_TABS, type Tab } from "../_mocks";

export function PatientsHeader() {
  const active: Tab = "all";

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-foreground">Пациенты</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Управление базой пациентов и планирование наблюдения
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border">
        <nav className="flex flex-wrap items-center gap-1">
          {MOCK_TABS.map((t) => {
            const isActive = t.key === active;
            return (
              <button
                key={t.key}
                type="button"
                className={cn(
                  "relative inline-flex items-center gap-2 px-3 py-2.5 text-sm transition-colors",
                  isActive
                    ? "font-semibold text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span>{t.label}</span>
                <span
                  className={cn(
                    "inline-flex min-w-[22px] items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                    t.highlight === "danger"
                      ? "bg-destructive/15 text-destructive"
                      : isActive
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {t.count}
                </span>
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 -bottom-px h-0.5 bg-primary"
                  />
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2 pb-2">
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <UploadIcon className="size-4 text-muted-foreground" />
            Экспорт
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <SlidersHorizontalIcon className="size-4 text-muted-foreground" />
            Настроить вид
          </button>
        </div>
      </div>
    </>
  );
}
