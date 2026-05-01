"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { doctorKey, type DoctorScheduleEntry } from "./use-doctor";

// Phase 11: cabinet is bound to the doctor (Doctor.cabinetId), not per-shift.
// `cabinetId` is no longer part of a slot — the editor used to surface it but
// every entry would just mirror Doctor.cabinetId, so it's gone now.
export type ScheduleSlotInput = {
  weekday: number;
  startTime: string;
  endTime: string;
};

/**
 * Convert "HH:mm" into minutes-since-midnight. Used both for the save payload
 * and for client-side overlap detection before submit.
 */
export function toMinutes(hhmm: string): number | null {
  const m = /^([0-9]{1,2}):([0-9]{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export type ScheduleConflict = {
  /** Index into the ordered slots array of the conflicting slot. */
  slotIndex: number;
  kind: "invalid-time" | "overlap";
};

/**
 * Detect invalid slots (end ≤ start) and same-day overlaps. Returns one
 * entry per problematic slot; the UI paints those slots red.
 */
export function detectScheduleConflicts(
  slots: ScheduleSlotInput[],
): ScheduleConflict[] {
  const problems: ScheduleConflict[] = [];
  // invalid-time pass
  slots.forEach((s, i) => {
    const a = toMinutes(s.startTime);
    const b = toMinutes(s.endTime);
    if (a === null || b === null || b <= a) {
      problems.push({ slotIndex: i, kind: "invalid-time" });
    }
  });

  // overlap: group by weekday, sort by start, flag any overlapping pair
  const invalidSet = new Set(
    problems.filter((p) => p.kind === "invalid-time").map((p) => p.slotIndex),
  );
  const byDay = new Map<number, { idx: number; a: number; b: number }[]>();
  slots.forEach((s, i) => {
    if (invalidSet.has(i)) return;
    const a = toMinutes(s.startTime);
    const b = toMinutes(s.endTime);
    if (a === null || b === null) return;
    const list = byDay.get(s.weekday) ?? [];
    list.push({ idx: i, a, b });
    byDay.set(s.weekday, list);
  });
  for (const list of byDay.values()) {
    list.sort((x, y) => x.a - y.a);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!;
      const curr = list[i]!;
      if (curr.a < prev.b) {
        problems.push({ slotIndex: curr.idx, kind: "overlap" });
      }
    }
  }
  return problems;
}

export function useReplaceDoctorSchedule(doctorId: string) {
  const qc = useQueryClient();
  return useMutation<
    { entries: DoctorScheduleEntry[] },
    Error,
    ScheduleSlotInput[]
  >({
    mutationFn: async (slots) => {
      const res = await fetch(`/api/crm/doctors/${doctorId}/schedule`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: slots.map((s) => ({
            weekday: s.weekday,
            startTime: s.startTime,
            endTime: s.endTime,
          })),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { entries: DoctorScheduleEntry[] };
    },
    onSuccess: (data) => {
      qc.setQueryData(doctorKey(doctorId), (prev: unknown) => {
        if (!prev || typeof prev !== "object") return prev;
        return { ...(prev as Record<string, unknown>), schedules: data.entries };
      });
      qc.invalidateQueries({ queryKey: doctorKey(doctorId) });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

export function useCreateTimeOff(doctorId: string) {
  const qc = useQueryClient();
  return useMutation<
    { id: string },
    Error,
    { startAt: string; endAt: string; reason: string | null }
  >({
    mutationFn: async (input) => {
      const res = await fetch(`/api/crm/doctors/${doctorId}/time-off`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: doctorKey(doctorId) });
    },
  });
}

export function useDeleteTimeOff(doctorId: string) {
  const qc = useQueryClient();
  return useMutation<{ id: string; deleted: true }, Error, string>({
    mutationFn: async (entryId) => {
      const res = await fetch(
        `/api/crm/doctors/${doctorId}/time-off?entryId=${entryId}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { id: string; deleted: true };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: doctorKey(doctorId) });
    },
  });
}
