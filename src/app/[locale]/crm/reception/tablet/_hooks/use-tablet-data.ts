"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";
import { useClinicToday } from "@/hooks/use-clinic-today";
import {
  summarizeDoctorDay,
  type DoctorDaySummary,
  type DoctorTodayLike,
  type TabletApptRow,
} from "@/lib/reception-tablet/doctor-day";

import {
  useActiveDoctors,
  useReceptionRealtime,
  useTodayAppointments,
  type DoctorRef,
} from "../../_hooks/use-reception-live";
import type { AppointmentRow } from "../../../appointments/_hooks/use-appointments-list";

/**
 * Data of the reception tablet. Everything lives under the `["reception"]`
 * query keys, so the walk-in, the check-in and the booking mutations (which
 * invalidate `["reception"]`) refresh the tablet the moment they succeed,
 * and so do the reception's SSE events (`useReceptionRealtime`).
 */

/** The doctors list row: the shared doctor columns (`DOCTOR_SHARED_SELECT`). */
export type TabletDoctor = DoctorRef & {
  ticketPrefix: string | null;
  cabinet: { id: string; number: string; floor?: number | null } | null;
};

type DoctorsTodayResponse = {
  date: string | null;
  doctors: DoctorTodayLike[];
};

/** The tablet's safety net under SSE (the desktop reception polls every 60 s). */
export const TABLET_POLL_MS = 30_000;

/** Schedule-aware «today» per doctor: working time, live status, next free slot. */
export function useTabletDoctorsToday() {
  return useQuery<DoctorsTodayResponse, Error>({
    queryKey: ["reception", "tablet", "doctors-today"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/doctors/today", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as DoctorsTodayResponse;
    },
    staleTime: 15_000,
  });
}

/**
 * Live updates: the reception's SSE invalidation (today's visits: who
 * waits, who is inside), the schedule summary when a booking appears, moves
 * or goes (its «свободно с»), a 30 s refetch of both while the screen is on,
 * and an immediate one when the iPad wakes up or the Wi-Fi comes back.
 */
export function useTabletLive(): void {
  useReceptionRealtime();
  useLiveQueryInvalidation({
    // Not on every queue move: the summary runs the slot finder per doctor,
    // and the queue numbers come from today's visits anyway.
    events: ["appointment.created", "appointment.cancelled", "appointment.moved"],
    queryKey: ["reception", "tablet"],
  });
  const qc = useQueryClient();
  React.useEffect(() => {
    const refetch = () => {
      if (document.visibilityState !== "visible") return;
      void qc.refetchQueries({ queryKey: ["reception", "appointments", "today"], type: "active" });
      void qc.refetchQueries({ queryKey: ["reception", "tablet"], type: "active" });
    };
    const id = window.setInterval(refetch, TABLET_POLL_MS);
    document.addEventListener("visibilitychange", refetch);
    window.addEventListener("online", refetch);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refetch);
      window.removeEventListener("online", refetch);
    };
  }, [qc]);
}

export type TabletData = {
  today: string;
  doctors: TabletDoctor[];
  rows: AppointmentRow[];
  summaries: Map<string, DoctorDaySummary>;
  isLoading: boolean;
  isError: boolean;
  /** Last successful refresh of the appointments, ms epoch (0 before one). */
  updatedAt: number;
  refetch: () => void;
};

/** Ticks every 30 s so «≈ 25 мин», «опаздывает» and the clock follow time. */
export function useMinuteClock(): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function useTabletData(now: Date): TabletData {
  const today = useClinicToday();
  const doctorsQuery = useActiveDoctors();
  const appointments = useTodayAppointments(today);
  const doctorsToday = useTabletDoctorsToday();

  const doctors = React.useMemo(
    () => (doctorsQuery.data ?? []) as TabletDoctor[],
    [doctorsQuery.data],
  );
  const rows = React.useMemo(() => appointments.data ?? [], [appointments.data]);

  const summaries = React.useMemo(() => {
    const byDoctor = new Map(
      (doctorsToday.data?.doctors ?? []).map((d) => [d.doctorId, d] as const),
    );
    // Without the schedule summary (its request failed) nobody may vanish
    // from the screen: every active doctor is then listed.
    const scheduleUnknown = !doctorsToday.data && doctorsToday.isError;
    const out = new Map<string, DoctorDaySummary>();
    for (const d of doctors) {
      out.set(
        d.id,
        summarizeDoctorDay({
          doctorId: d.id,
          rows: rows as unknown as TabletApptRow[],
          today: byDoctor.get(d.id),
          scheduleUnknown,
          now,
        }),
      );
    }
    return out;
  }, [doctors, rows, doctorsToday.data, doctorsToday.isError, now]);

  const { refetch: refetchDoctors } = doctorsQuery;
  const { refetch: refetchAppointments } = appointments;
  const { refetch: refetchToday } = doctorsToday;
  const refetch = React.useCallback(() => {
    void refetchDoctors();
    void refetchAppointments();
    void refetchToday();
  }, [refetchDoctors, refetchAppointments, refetchToday]);

  return {
    today,
    doctors,
    rows,
    summaries,
    // The schedule decides who is on screen: until it is in, the tiles wait
    // (an empty «никто не работает» must not flash on every open).
    isLoading: doctorsQuery.isLoading || appointments.isLoading || doctorsToday.isLoading,
    // The schedule summary failing alone still leaves a working screen
    // (every active doctor is then listed by his visits); the doctors or
    // the day's visits failing does not.
    isError:
      (doctorsQuery.isError && !doctorsQuery.data) ||
      (appointments.isError && !appointments.data),
    updatedAt: appointments.dataUpdatedAt,
    refetch,
  };
}

/** `navigator.onLine`, kept current. */
export function useOnline(): boolean {
  const [online, setOnline] = React.useState(true);
  React.useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}

/** True once `active` has stayed true for `afterMs` (a slow request). */
export function useSlowFlag(active: boolean, afterMs = 5_000): boolean {
  const [slow, setSlow] = React.useState(false);
  React.useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const id = window.setTimeout(() => setSlow(true), afterMs);
    return () => window.clearTimeout(id);
  }, [active, afterMs]);
  return slow;
}
