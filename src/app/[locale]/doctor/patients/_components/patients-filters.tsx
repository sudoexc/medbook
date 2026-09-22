"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { usePatientsFilters } from "../_hooks/patients-context";

/*
 * Only controls that actually filter live here. The four dropdowns that used
 * to sit next to the search box (диагнозы / статусы / возраст / период) were
 * static mockups with no handlers and no API behind them — a doctor clicking
 * them got nothing, which is worse than not offering them. Segments live in
 * the tab strip above; search is the real filter, so it gets the room.
 */

export function PatientsFilters() {
  const t = useTranslations("doctor.patients");
  const { setQ } = usePatientsFilters();
  const [value, setValue] = React.useState("");

  const update = (next: string) => {
    setValue(next);
    setQ(next);
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-3">
      <label className="relative block">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={value}
          placeholder={t("filters.searchPlaceholder")}
          onChange={(e) => update(e.target.value)}
          className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-9 text-sm placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15"
        />
        {value ? (
          <button
            type="button"
            aria-label={t("filters.clear")}
            onClick={() => update("")}
            className="absolute right-2 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        ) : null}
      </label>
    </section>
  );
}
