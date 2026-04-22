"use client";

import * as React from "react";

/**
 * Booking flow state, persisted to sessionStorage so the user can refresh
 * within a step (or the MainButton reloads) without losing their choices.
 *
 * Shape: { serviceIds, doctorId, date (YYYY-MM-DD), time (HH:mm) }.
 */
export type BookingDraft = {
  serviceIds: string[];
  doctorId: string | null;
  date: string | null;
  time: string | null;
};

const EMPTY: BookingDraft = {
  serviceIds: [],
  doctorId: null,
  date: null,
  time: null,
};

function storageKey(slug: string) {
  return `miniapp:${slug}:bookingDraft`;
}

export function useBookingDraft(clinicSlug: string) {
  const [draft, setDraftState] = React.useState<BookingDraft>(EMPTY);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey(clinicSlug));
      if (raw) {
        const parsed = JSON.parse(raw) as BookingDraft;
        setDraftState({ ...EMPTY, ...parsed });
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, [clinicSlug]);

  const setDraft = React.useCallback(
    (patch: Partial<BookingDraft>) => {
      setDraftState((prev) => {
        const next = { ...prev, ...patch };
        try {
          sessionStorage.setItem(storageKey(clinicSlug), JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [clinicSlug],
  );

  const reset = React.useCallback(() => {
    setDraftState(EMPTY);
    try {
      sessionStorage.removeItem(storageKey(clinicSlug));
    } catch {
      /* ignore */
    }
  }, [clinicSlug]);

  return { draft, setDraft, reset, hydrated };
}
