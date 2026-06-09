"use client";

import { ChevronDownIcon, FilterIcon, SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { usePatientsFilters } from "../_hooks/patients-context";

const SELECT_KEYS = [
  "filters.allDiagnoses",
  "filters.allStatuses",
  "filters.age",
  "filters.visitPeriod",
] as const;

export function PatientsFilters() {
  const t = useTranslations("doctor.patients");
  const { setQ } = usePatientsFilters();

  return (
    <section className="rounded-2xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[260px] flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder={t("filters.searchPlaceholder")}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15"
          />
        </label>

        {SELECT_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-foreground transition-colors hover:bg-muted"
          >
            {t(key)}
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          </button>
        ))}

        <button
          type="button"
          className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <FilterIcon className="size-4 text-muted-foreground" />
          {t("filters.filters")}
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        </button>
      </div>
    </section>
  );
}
