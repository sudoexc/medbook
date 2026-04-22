"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

export type CalendarView = "day" | "workWeek" | "week";

export type CalendarFilters = {
  view: CalendarView;
  date: string; // YYYY-MM-DD
  doctorIds: string[];
  cabinetIds: string[];
  serviceIds: string[];
  cabinetOverlay: boolean;
};

const DEFAULT_VIEW: CalendarView = "workWeek";

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseView(v: string | null): CalendarView {
  if (v === "day" || v === "workWeek" || v === "week") return v;
  return DEFAULT_VIEW;
}

function parseDate(v: string | null): string {
  if (!v) return todayKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return todayKey();
  return v;
}

function parseIds(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * URL-backed filters for the calendar page. Keeps query params in sync with
 * view/date/filter state so bookmarks and deep-links stay stable.
 */
export function useCalendarFilters() {
  const router = useRouter();
  const params = useSearchParams();

  const filters = React.useMemo<CalendarFilters>(
    () => ({
      view: parseView(params.get("view")),
      date: parseDate(params.get("date")),
      doctorIds: parseIds(params.get("doctors")),
      cabinetIds: parseIds(params.get("cabinets")),
      serviceIds: parseIds(params.get("services")),
      cabinetOverlay: params.get("overlay") === "cabinet",
    }),
    [params],
  );

  const replace = React.useCallback(
    (next: Partial<CalendarFilters>) => {
      const merged: CalendarFilters = { ...filters, ...next };
      const sp = new URLSearchParams();
      if (merged.view !== DEFAULT_VIEW) sp.set("view", merged.view);
      if (merged.date !== todayKey()) sp.set("date", merged.date);
      if (merged.doctorIds.length) sp.set("doctors", merged.doctorIds.join(","));
      if (merged.cabinetIds.length)
        sp.set("cabinets", merged.cabinetIds.join(","));
      if (merged.serviceIds.length)
        sp.set("services", merged.serviceIds.join(","));
      if (merged.cabinetOverlay) sp.set("overlay", "cabinet");
      const qs = sp.toString();
      router.replace(qs ? `?${qs}` : `?`, { scroll: false });
    },
    [router, filters],
  );

  return { filters, setFilters: replace } as const;
}
