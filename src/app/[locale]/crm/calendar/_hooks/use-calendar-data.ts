"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useLiveEvents } from "@/hooks/use-live-events";

import type {
  AppointmentRow,
  AppointmentsListResponse,
} from "../../appointments/_hooks/use-appointments-list";

export type DoctorResource = {
  id: string;
  nameRu: string;
  nameUz: string;
  photoUrl: string | null;
  color: string | null;
  isActive: boolean;
};

export type CabinetRef = {
  id: string;
  number: string;
  isActive: boolean;
};

export type ServiceRef = {
  id: string;
  nameRu: string;
  nameUz: string;
  category: string | null;
  durationMin: number;
  priceBase: number;
};

export function calendarRangeKey(fromIso: string, toIso: string) {
  return ["calendar", "appointments", fromIso, toIso] as const;
}

/**
 * Loads every appointment in the visible date range. Unlike the paginated
 * appointments table, the calendar fetches **all rows** for the window and
 * filters client-side by doctor / cabinet / service so toggling those
 * selectors is instant.
 */
export function useCalendarAppointments(from: Date, to: Date) {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  return useQuery<AppointmentRow[], Error>({
    queryKey: calendarRangeKey(fromIso, toIso),
    queryFn: async ({ signal }) => {
      const out: AppointmentRow[] = [];
      let cursor: string | undefined;
      // Loop cursor pages — the API caps `limit` at 200.
      for (let i = 0; i < 10; i += 1) {
        const sp = new URLSearchParams();
        sp.set("from", fromIso);
        sp.set("to", toIso);
        sp.set("limit", "200");
        sp.set("sort", "date");
        sp.set("dir", "asc");
        if (cursor) sp.set("cursor", cursor);
        const res = await fetch(`/api/crm/appointments?${sp.toString()}`, {
          credentials: "include",
          signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as AppointmentsListResponse;
        out.push(...j.rows);
        if (!j.nextCursor) break;
        cursor = j.nextCursor;
      }
      return out;
    },
    // SSE invalidation wires the `calendar` query keys on every
    // `appointment.*` event (see `useCalendarRealtime`). Polling stays on
    // as a 60-second fallback so a dropped socket still eventually catches
    // up on its own.
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}

/**
 * Subscribe every `["calendar", "appointments", ...]` query to `appointment.*`
 * events. The shape of the key ends with `[fromIso, toIso]`, so we use a
 * prefix invalidation — TanStack Query handles sub-matching.
 */
export function useCalendarRealtime(): void {
  const qc = useQueryClient();
  useLiveEvents(
    () => {
      void qc.invalidateQueries({ queryKey: ["calendar", "appointments"] });
    },
    {
      filter: [
        "appointment.created",
        "appointment.updated",
        "appointment.statusChanged",
        "appointment.cancelled",
        "appointment.moved",
      ],
    },
  );
}

export function useActiveDoctors() {
  return useQuery<DoctorResource[], Error>({
    queryKey: ["calendar", "doctors"],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/doctors?isActive=true&limit=200`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: DoctorResource[] };
      return j.rows;
    },
    staleTime: 5 * 60_000,
  });
}

export function useCabinets() {
  return useQuery<CabinetRef[], Error>({
    queryKey: ["calendar", "cabinets"],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/cabinets?isActive=true&limit=200`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: CabinetRef[] };
      return j.rows;
    },
    staleTime: 5 * 60_000,
  });
}

export function useServicesRef() {
  return useQuery<ServiceRef[], Error>({
    queryKey: ["calendar", "services"],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/services?isActive=true&limit=200`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: ServiceRef[] };
      return j.rows;
    },
    staleTime: 5 * 60_000,
  });
}
