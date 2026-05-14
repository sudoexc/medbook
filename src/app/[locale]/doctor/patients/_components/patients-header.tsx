"use client";

import { ChevronDownIcon, SlidersHorizontalIcon, UploadIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { usePatientsFilters } from "../_hooks/patients-context";
import type { DoctorPatientTab } from "../_hooks/use-my-patients";

const TABS: Array<{
  key: DoctorPatientTab;
  label: string;
  highlight?: "danger";
}> = [
  { key: "all", label: "Все пациенты" },
  { key: "active", label: "Активные" },
  { key: "new", label: "Новые" },
  { key: "watch", label: "На контроле" },
  { key: "returned", label: "Вернулись" },
  { key: "dormant", label: "Давно не были", highlight: "danger" },
];

export function PatientsHeader() {
  const { filters, setTab } = usePatientsFilters();
  const active = filters.tab ?? "all";

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
          {TABS.map((t) => {
            const isActive = t.key === active;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "relative inline-flex items-center gap-2 px-3 py-2.5 text-sm transition-colors",
                  isActive
                    ? "font-semibold text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span>{t.label}</span>
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
