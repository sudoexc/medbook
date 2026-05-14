"use client";

import * as React from "react";
import { RotateCcwIcon, SearchIcon } from "lucide-react";

import { useDocumentsFilters } from "../_hooks/documents-context";

export function DocumentsFilters() {
  const { setQ, setTab } = useDocumentsFilters();
  const [raw, setRaw] = React.useState("");

  return (
    <section className="rounded-2xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[260px] flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setQ(e.target.value);
            }}
            placeholder="Поиск по названию или пациенту..."
            className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15"
          />
        </label>

        <button
          type="button"
          onClick={() => {
            setRaw("");
            setQ("");
            setTab("all");
          }}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/5"
        >
          <RotateCcwIcon className="size-3.5" />
          Сбросить
        </button>
      </div>
    </section>
  );
}
