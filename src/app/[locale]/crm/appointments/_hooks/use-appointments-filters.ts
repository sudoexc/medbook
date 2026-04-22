"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { AppointmentsListFilters } from "./use-appointments-list";

/**
 * URL-backed filter state for the Записи page.
 *
 * Two helpers are handy on top of the raw fields:
 *
 *  - `dateMode` → quick pill selection (`today`/`week`/`month`/`range`).
 *    The server-facing hook only cares about `from`/`to` so we compute them
 *    here when the user picks a pill.
 *  - `bucket` → the status pill above the table (`all` | `waiting` | ...).
 *    We translate that to `status` before calling the API.
 */
export type DateMode = "today" | "week" | "month" | "range";
export type StatusBucket =
  | "all"
  | "waiting"
  | "booked"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export type AppointmentsFilterState = AppointmentsListFilters & {
  dateMode?: DateMode;
  bucket?: StatusBucket;
};

const KNOWN_KEYS: (keyof AppointmentsFilterState)[] = [
  "from",
  "to",
  "doctorId",
  "patientId",
  "cabinetId",
  "status",
  "channel",
  "serviceId",
  "onlyUnpaid",
  "q",
  "sort",
  "dir",
  "dateMode",
  "bucket",
];

function parse(sp: URLSearchParams): AppointmentsFilterState {
  const out: AppointmentsFilterState = {};
  for (const key of KNOWN_KEYS) {
    const v = sp.get(key);
    if (!v) continue;
    if (key === "onlyUnpaid") {
      out.onlyUnpaid = v === "true" || v === "1";
    } else if (key === "sort") {
      if (v === "date" || v === "createdAt") out.sort = v;
    } else if (key === "dir") {
      if (v === "asc" || v === "desc") out.dir = v;
    } else if (key === "dateMode") {
      if (v === "today" || v === "week" || v === "month" || v === "range") {
        out.dateMode = v;
      }
    } else if (key === "bucket") {
      const allowed: StatusBucket[] = [
        "all",
        "waiting",
        "booked",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
      ];
      if ((allowed as string[]).includes(v)) {
        out.bucket = v as StatusBucket;
      }
    } else {
      (out as Record<string, string>)[key] = v;
    }
  }
  return out;
}

function serialize(state: AppointmentsFilterState): URLSearchParams {
  const sp = new URLSearchParams();
  for (const key of KNOWN_KEYS) {
    const v = state[key];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "boolean") {
      if (v) sp.set(key, "true");
    } else {
      sp.set(key, String(v));
    }
  }
  return sp;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

/**
 * Translate `dateMode` + explicit `from`/`to` to a concrete window.
 * "today" → [startOfDay, endOfDay] of now.
 * "week"  → next 7 days starting now.
 * "month" → next 30 days starting now.
 * "range" → respect explicit `from`/`to` as-is.
 */
function resolveWindow(
  state: AppointmentsFilterState,
): { from?: string; to?: string } {
  const mode = state.dateMode ?? (state.from || state.to ? "range" : "today");
  const now = new Date();
  if (mode === "today") {
    return {
      from: startOfDay(now).toISOString(),
      to: endOfDay(now).toISOString(),
    };
  }
  if (mode === "week") {
    return {
      from: startOfDay(now).toISOString(),
      to: endOfDay(
        new Date(now.getFullYear(), now.getMonth(), now.getDate() + 6),
      ).toISOString(),
    };
  }
  if (mode === "month") {
    return {
      from: startOfDay(now).toISOString(),
      to: endOfDay(
        new Date(now.getFullYear(), now.getMonth(), now.getDate() + 29),
      ).toISOString(),
    };
  }
  return {
    from: state.from || undefined,
    to: state.to || undefined,
  };
}

const BUCKET_TO_STATUS: Record<StatusBucket, string | undefined> = {
  all: undefined,
  waiting: "WAITING",
  booked: "BOOKED",
  in_progress: "IN_PROGRESS",
  completed: "COMPLETED",
  cancelled: "CANCELLED",
  no_show: "NO_SHOW",
};

export function useAppointmentsFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = React.useMemo(
    () => parse(new URLSearchParams(searchParams?.toString() ?? "")),
    [searchParams],
  );

  const updateUrl = React.useCallback(
    (next: AppointmentsFilterState) => {
      const sp = serialize(next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const setFilter = React.useCallback(
    <K extends keyof AppointmentsFilterState>(
      key: K,
      value: AppointmentsFilterState[K] | undefined,
    ) => {
      const next = { ...state, [key]: value } as AppointmentsFilterState;
      if (
        value === undefined ||
        value === "" ||
        value === null ||
        value === false
      ) {
        delete (next as Record<string, unknown>)[key as string];
      }
      updateUrl(next);
    },
    [state, updateUrl],
  );

  const clearAll = React.useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  /**
   * Compute the effective filter payload that goes to the server. Normalises
   * `dateMode` to concrete `from`/`to` and `bucket` to `status`.
   */
  const apiFilters: AppointmentsListFilters = React.useMemo(() => {
    const { from, to } = resolveWindow(state);
    const status =
      state.bucket && state.bucket !== "all"
        ? BUCKET_TO_STATUS[state.bucket]
        : state.status;
    return {
      from,
      to,
      doctorId: state.doctorId,
      cabinetId: state.cabinetId,
      status,
      channel: state.channel,
      serviceId: state.serviceId,
      onlyUnpaid: state.onlyUnpaid,
      q: state.q,
      sort: state.sort ?? "date",
      dir: state.dir ?? "asc",
    };
  }, [state]);

  return {
    state,
    apiFilters,
    setFilter,
    clearAll,
  };
}
