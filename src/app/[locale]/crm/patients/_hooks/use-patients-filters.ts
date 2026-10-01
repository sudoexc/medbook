"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { PatientsListFilters } from "./use-patients-list";

/**
 * Parsed URL filter state for the patients list. Mirrors the fields accepted
 * by `/api/crm/patients` — plus two local-only view fields (`ageMin` / `ageMax`)
 * used for client-side DOB filtering while the server has no such columns yet.
 */
export type PatientsFilterState = PatientsListFilters & {
  ageMin?: number;
  ageMax?: number;
};

/** `PatientSegment` values the list API accepts (`QueryPatientSchema`). */
const PATIENT_SEGMENTS = ["NEW", "ACTIVE", "DORMANT", "VIP", "CHURN"] as const;

const KNOWN_KEYS: (keyof PatientsFilterState)[] = [
  "q",
  "segment",
  "source",
  "gender",
  "tag",
  "balance",
  "registeredFrom",
  "registeredTo",
  "visitedFrom",
  "visitedTo",
  "sort",
  "dir",
  "ageMin",
  "ageMax",
];

/** URL → filter state. Exported for tests. */
export function parse(sp: URLSearchParams): PatientsFilterState {
  const out: PatientsFilterState = {};
  for (const key of KNOWN_KEYS) {
    const v = sp.get(key);
    if (!v) continue;
    if (key === "ageMin" || key === "ageMax") {
      const n = Number(v);
      if (Number.isFinite(n)) (out[key] as number) = n;
    } else if (key === "segment") {
      // The API takes the enum only; a link with `segment=dormant` (the
      // Action Center's old «Запустить реактивацию») made the whole list
      // fail with a 400 (audit UX-09). Match case-insensitively, drop the
      // rest.
      const upper = v.toUpperCase();
      if ((PATIENT_SEGMENTS as readonly string[]).includes(upper)) {
        out.segment = upper;
      }
    } else if (key === "visitedFrom" || key === "visitedTo") {
      // Tashkent days only: anything else would fail the whole list.
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) out[key] = v;
    } else if (key === "balance") {
      if (v === "debt" || v === "zero" || v === "credit") out.balance = v;
    } else if (key === "sort") {
      const allowed = [
        "createdAt",
        "lastVisitAt",
        "visitsCount",
        "ltv",
        "fullName",
      ] as const;
      if ((allowed as readonly string[]).includes(v)) {
        out.sort = v as (typeof allowed)[number];
      }
    } else if (key === "dir") {
      if (v === "asc" || v === "desc") out.dir = v;
    } else {
      (out as Record<string, string>)[key] = v;
    }
  }
  return out;
}

/**
 * The CSV export's `filters` for the list state (audit PT-19): the same
 * keys the list sends, plus the age range the page applies on the loaded
 * rows. Sorting does not change which patients are in the file.
 */
export function exportFiltersOf(
  state: PatientsFilterState,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of [
    "q",
    "segment",
    "source",
    "gender",
    "tag",
    "balance",
    "registeredFrom",
    "registeredTo",
    "visitedFrom",
    "visitedTo",
    "ageMin",
    "ageMax",
  ] as const) {
    const v = state[key];
    if (v !== undefined && v !== null && v !== "") out[key] = v;
  }
  return out;
}

/**
 * Apply several filter changes at once. An undefined, null or empty value
 * drops its key. Exported for tests (audit PT-17).
 */
export function mergeFilters(
  state: PatientsFilterState,
  patch: Partial<PatientsFilterState>,
): PatientsFilterState {
  const next = { ...state, ...patch } as PatientsFilterState;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === "" || value === null) {
      delete (next as Record<string, unknown>)[key];
    }
  }
  return next;
}

function serialize(state: PatientsFilterState): URLSearchParams {
  const sp = new URLSearchParams();
  for (const key of KNOWN_KEYS) {
    const v = state[key];
    if (v === undefined || v === null || v === "") continue;
    sp.set(key, String(v));
  }
  return sp;
}

export function usePatientsFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = React.useMemo(
    () => parse(new URLSearchParams(searchParams?.toString() ?? "")),
    [searchParams],
  );

  const updateUrl = React.useCallback(
    (next: PatientsFilterState) => {
      const sp = serialize(next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const setFilter = React.useCallback(
    <K extends keyof PatientsFilterState>(
      key: K,
      value: PatientsFilterState[K] | undefined,
    ) => {
      updateUrl(
        mergeFilters(state, { [key]: value } as Partial<PatientsFilterState>),
      );
    },
    [state, updateUrl],
  );

  /**
   * Several keys in one URL write (audit PT-17). Two `setFilter` calls in a
   * row both start from the same closed-over `state`, so the second write
   * drops the first: a click on «Последний визит» sent `sort` and `dir`
   * separately and the list kept sorting by registration date.
   */
  const setFilters = React.useCallback(
    (patch: Partial<PatientsFilterState>) => {
      updateUrl(mergeFilters(state, patch));
    },
    [state, updateUrl],
  );

  const clearAll = React.useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  // API-facing subset (server doesn't know ageMin/ageMax yet — filtered client-side).
  const apiFilters: PatientsListFilters = React.useMemo(() => {
    const { ageMin: _min, ageMax: _max, ...rest } = state;
    void _min;
    void _max;
    return rest;
  }, [state]);

  return {
    state,
    apiFilters,
    setFilter,
    setFilters,
    clearAll,
  };
}
