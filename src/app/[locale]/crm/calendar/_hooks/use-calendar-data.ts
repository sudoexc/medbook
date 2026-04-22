"use client";

import { useQuery } from "@tanstack/react-query";

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
    queryFn: async () => {
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
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as AppointmentsListResponse;
        out.push(...j.rows);
        if (!j.nextCursor) break;
        cursor = j.nextCursor;
      }
      return out;
    },
    // TODO(realtime-engineer): remove 30 s polling once SSE `appointment.*`
    // events invalidate this key on push. Keep the fallback for offline / SSE
    // failure scenarios.
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useActiveDoctors() {
  return useQuery<DoctorResource[], Error>({
    queryKey: ["calendar", "doctors"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/doctors?isActive=true&limit=200`, {
        credentials: "include",
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
    queryFn: async () => {
      const res = await fetch(`/api/crm/cabinets?isActive=true&limit=200`, {
        credentials: "include",
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
    queryFn: async () => {
      const res = await fetch(`/api/crm/services?isActive=true&limit=200`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: ServiceRef[] };
      return j.rows;
    },
    staleTime: 5 * 60_000,
  });
}
