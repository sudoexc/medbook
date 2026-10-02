"use client";

import { useQueries } from "@tanstack/react-query";

/**
 * Today's free slots per doctor: the «HH:mm» starts the SlotPicker offers
 * (`/api/crm/appointments/slots/available`: the doctor's schedule, time off
 * and bookings, today's passed slots dropped). One query per doctor, in the
 * order of `doctorIds`, shared by every screen that shows free slots, so
 * the «Записи» rail and the calendar's tile and rail agree. The calendar
 * used to guess them from an 11 hour day for all doctors at once (audit
 * AP-20). Appointment writes invalidate `["appointments","slots"]`.
 */
export function useTodayFreeSlots(doctorIds: string[]) {
  return useQueries({
    queries: doctorIds.map((id) => ({
      queryKey: ["appointments", "slots", id, "today"] as const,
      queryFn: async ({ signal }: { signal?: AbortSignal }) => {
        const dateIso = new Date().toISOString();
        const res = await fetch(
          `/api/crm/appointments/slots/available?doctorId=${id}&date=${encodeURIComponent(dateIso)}`,
          { credentials: "include", signal },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as { slots: string[] };
        return j.slots ?? [];
      },
      staleTime: 60_000,
    })),
  });
}
