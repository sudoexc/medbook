"use client";

import * as React from "react";

export type DoctorPanelView = "grid" | "list";
export type DoctorPanelSort = "load" | "name" | "next";
export type DoctorPanelDensity = "comfortable" | "compact";

export interface DoctorPanelPrefs {
  view: DoctorPanelView;
  hideIdle: boolean;
  sortBy: DoctorPanelSort;
  density: DoctorPanelDensity;
  showCabinet: boolean;
  showNextSlot: boolean;
}

export const DEFAULT_PANEL_PREFS: DoctorPanelPrefs = {
  view: "grid",
  hideIdle: false,
  sortBy: "load",
  density: "comfortable",
  showCabinet: true,
  showNextSlot: true,
};

const STORAGE_KEY = "reception:doctorPanelPrefs:v1";

function readPrefs(): DoctorPanelPrefs {
  if (typeof window === "undefined") return DEFAULT_PANEL_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PANEL_PREFS;
    const parsed = JSON.parse(raw) as Partial<DoctorPanelPrefs>;
    return { ...DEFAULT_PANEL_PREFS, ...parsed };
  } catch {
    return DEFAULT_PANEL_PREFS;
  }
}

/**
 * Persisted preferences for the reception "Кабинеты и врачи" panel.
 * Stored per-device in localStorage so a single operator's tweaks don't
 * leak across machines or users.
 */
export function useDoctorPanelPrefs(): {
  prefs: DoctorPanelPrefs;
  setPrefs: (patch: Partial<DoctorPanelPrefs>) => void;
  reset: () => void;
} {
  const [prefs, setState] = React.useState<DoctorPanelPrefs>(DEFAULT_PANEL_PREFS);

  React.useEffect(() => {
    setState(readPrefs());
  }, []);

  const setPrefs = React.useCallback((patch: Partial<DoctorPanelPrefs>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore quota / disabled storage
      }
      return next;
    });
  }, []);

  const reset = React.useCallback(() => {
    setState(DEFAULT_PANEL_PREFS);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return { prefs, setPrefs, reset };
}
