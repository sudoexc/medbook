"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { DoctorsListFilters } from "./use-doctors-list";

export type DoctorsSort = "name" | "rating" | "load" | "revenue";
export type PeriodKey = "today" | "week" | "month" | "quarter";

export type DoctorsFilterState = DoctorsListFilters & {
  sort?: DoctorsSort;
  period?: PeriodKey;
  /** Show only active doctors. When absent, shows all. */
  onlyActive?: boolean;
};

const KNOWN_KEYS: (keyof DoctorsFilterState)[] = [
  "q",
  "specialization",
  "isActive",
  "sort",
  "period",
  "onlyActive",
];

function parse(sp: URLSearchParams): DoctorsFilterState {
  const out: DoctorsFilterState = {};
  const q = sp.get("q");
  if (q) out.q = q;
  const spec = sp.get("specialization");
  if (spec) out.specialization = spec;
  const sort = sp.get("sort");
  if (sort === "name" || sort === "rating" || sort === "load" || sort === "revenue")
    out.sort = sort;
  const period = sp.get("period");
  if (
    period === "today" ||
    period === "week" ||
    period === "month" ||
    period === "quarter"
  )
    out.period = period;
  const onlyActive = sp.get("onlyActive");
  if (onlyActive === "1") out.onlyActive = true;
  return out;
}

function serialize(state: DoctorsFilterState): URLSearchParams {
  const sp = new URLSearchParams();
  if (state.q) sp.set("q", state.q);
  if (state.specialization) sp.set("specialization", state.specialization);
  if (state.sort) sp.set("sort", state.sort);
  if (state.period) sp.set("period", state.period);
  if (state.onlyActive) sp.set("onlyActive", "1");
  return sp;
}

export function usePeriodRange(period: PeriodKey): { from: string; to: string } {
  return React.useMemo(() => {
    const now = new Date();
    const to = new Date(now);
    const from = new Date(now);
    if (period === "today") {
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
    } else if (period === "week") {
      from.setDate(now.getDate() - 6);
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
    } else if (period === "month") {
      from.setDate(now.getDate() - 29);
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
    } else {
      // quarter
      from.setDate(now.getDate() - 89);
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
    }
    return {
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }, [period]);
}

export function useDoctorsFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = React.useMemo(
    () => parse(new URLSearchParams(searchParams?.toString() ?? "")),
    [searchParams],
  );

  const updateUrl = React.useCallback(
    (next: DoctorsFilterState) => {
      const sp = serialize(next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const setFilter = React.useCallback(
    <K extends keyof DoctorsFilterState>(
      key: K,
      value: DoctorsFilterState[K] | undefined,
    ) => {
      const next = { ...state, [key]: value } as DoctorsFilterState;
      if (value === undefined || value === null || value === "" || value === false) {
        delete (next as Record<string, unknown>)[key as string];
      }
      updateUrl(next);
    },
    [state, updateUrl],
  );

  const clearAll = React.useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  // API-facing filters: apply "onlyActive" toggle to `isActive`.
  const apiFilters: DoctorsListFilters = React.useMemo(() => {
    const out: DoctorsListFilters = {};
    if (state.q) out.q = state.q;
    if (state.specialization) out.specialization = state.specialization;
    if (state.onlyActive) out.isActive = true;
    return out;
  }, [state]);

  const effectivePeriod: PeriodKey = state.period ?? "month";
  const effectiveSort: DoctorsSort = state.sort ?? "name";

  return {
    state,
    apiFilters,
    effectivePeriod,
    effectiveSort,
    setFilter,
    clearAll,
  };
}
