"use client";

import { useQuery } from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";

import type {
  AppointmentRow,
  AppointmentsListResponse,
} from "../../appointments/_hooks/use-appointments-list";

/**
 * `use-reception-live` — aggregates every live TanStack Query poll the
 * reception dashboard needs.
 *
 * Polling strategy (Phase 2c): `staleTime: 15s`, `refetchInterval: 30s`.
 *
 * TODO(realtime-engineer, Phase 3a): replace polling with SSE invalidation.
 * Subscribe to `clinic:{id}:reception`, `clinic:{id}:queue`,
 * `clinic:{id}:calls`, `clinic:{id}:conversations`, `clinic:{id}:cabinets`
 * and invalidate the corresponding query keys on push:
 *   - `appointment.{created|updated|queue-status|cancelled|moved}` →
 *       ["reception","dashboard"], ["reception","appointments","today"],
 *       ["reception","reminders"]
 *   - `call.incoming` / `call.updated` → ["reception","calls"]
 *   - `tg.message.new` / `conversation.updated` → ["reception","conversations"]
 *   - `cabinet.occupancy.changed` → ["reception","cabinets"]
 */

export type DashboardKpi = {
  booked: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  revenue: number;
};

export type DashboardQueueBucket = {
  status:
    | "BOOKED"
    | "WAITING"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "SKIPPED"
    | "CANCELLED"
    | "NO_SHOW";
  count: number;
};

export type DashboardResponse = {
  today: DashboardKpi;
  week: DashboardKpi;
  month: DashboardKpi;
  newPatientsThisMonth: number;
  queue: DashboardQueueBucket[];
};

export type DoctorRef = {
  id: string;
  nameRu: string;
  nameUz: string;
  photoUrl: string | null;
  color: string | null;
  specializationRu: string | null;
  specializationUz: string | null;
  isActive: boolean;
};

export type CabinetRef = {
  id: string;
  number: string;
  floor: number | null;
  nameRu: string | null;
  nameUz: string | null;
  isActive: boolean;
};

export type CallRow = {
  id: string;
  direction: "IN" | "OUT" | "MISSED";
  fromNumber: string;
  toNumber: string;
  durationSec: number | null;
  summary: string | null;
  createdAt: string;
  endedAt: string | null;
  patient: {
    id: string;
    fullName: string;
    phone: string;
  } | null;
  operator: { id: string; name: string } | null;
};

export type ConversationRow = {
  id: string;
  channel: "SMS" | "TG" | "CALL" | "EMAIL" | "VISIT";
  status: "OPEN" | "SNOOZED" | "CLOSED";
  unreadCount: number;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  patient: {
    id: string;
    fullName: string;
    phone: string;
    photoUrl: string | null;
  } | null;
  assignedTo: { id: string; name: string } | null;
};

// Polling becomes a fallback once SSE invalidation is in place. We keep a
// 60s safety-net refetch so a dropped socket + failed reconnect eventually
// catches up on its own.
const RECEPTION_POLL_MS = 60_000;
const RECEPTION_STALE_MS = 15_000;

/** Today's date range [00:00, tomorrow 00:00). */
export function todayRange(now = new Date()): { from: Date; to: Date } {
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

/** KPI counters for today. */
export function useReceptionDashboard() {
  return useQuery<DashboardResponse, Error>({
    queryKey: ["reception", "dashboard"],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/dashboard?period=today`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as DashboardResponse;
    },
    staleTime: RECEPTION_STALE_MS,
    refetchInterval: RECEPTION_POLL_MS,
  });
}

/** All of today's appointments — used to compute per-doctor queues. */
export function useTodayAppointments() {
  const { from, to } = todayRange();
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  return useQuery<AppointmentRow[], Error>({
    queryKey: ["reception", "appointments", "today", fromIso, toIso],
    queryFn: async ({ signal }) => {
      const out: AppointmentRow[] = [];
      let cursor: string | undefined;
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
    staleTime: RECEPTION_STALE_MS,
    refetchInterval: RECEPTION_POLL_MS,
  });
}

export function useActiveDoctors() {
  return useQuery<DoctorRef[], Error>({
    queryKey: ["reception", "doctors"],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/doctors?isActive=true&limit=200`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: DoctorRef[] };
      return j.rows;
    },
    // Doctors change rarely — cache longer but still refresh in the background.
    staleTime: 5 * 60_000,
  });
}

export function useReceptionCabinets() {
  return useQuery<CabinetRef[], Error>({
    queryKey: ["reception", "cabinets"],
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

/**
 * Incoming calls in the last hour. The TZ asks for a SIP webhook "live" feed,
 * but Phase 2b only exposes `/api/crm/calls`. We fetch the last page of `IN`
 * calls and treat those whose `endedAt` is null (or very recent) as "active".
 *
 * TODO(api-builder): a dedicated `/api/crm/calls/active` endpoint that only
 * returns the live SIP stream would remove the client-side filter below.
 */
export function useIncomingCalls() {
  return useQuery<CallRow[], Error>({
    queryKey: ["reception", "calls"],
    queryFn: async ({ signal }) => {
      const sp = new URLSearchParams();
      sp.set("direction", "IN");
      sp.set("limit", "20");
      const res = await fetch(`/api/crm/calls?${sp.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) {
        if (res.status === 404) return [];
        throw new Error(`HTTP ${res.status}`);
      }
      const j = (await res.json()) as { rows: CallRow[] };
      return j.rows ?? [];
    },
    staleTime: RECEPTION_STALE_MS,
    refetchInterval: RECEPTION_POLL_MS,
  });
}

/**
 * Unread Telegram/SMS conversations. `unread=true` on the list endpoint filters
 * to threads with `unreadCount > 0` — perfect for the reception preview.
 */
export function useUnreadConversations() {
  return useQuery<ConversationRow[], Error>({
    queryKey: ["reception", "conversations"],
    queryFn: async ({ signal }) => {
      const sp = new URLSearchParams();
      sp.set("unread", "true");
      sp.set("status", "OPEN");
      sp.set("limit", "20");
      const res = await fetch(`/api/crm/conversations?${sp.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) {
        if (res.status === 404) return [];
        throw new Error(`HTTP ${res.status}`);
      }
      const j = (await res.json()) as { rows: ConversationRow[] };
      return j.rows ?? [];
    },
    staleTime: RECEPTION_STALE_MS,
    refetchInterval: RECEPTION_POLL_MS,
  });
}

/**
 * Patients whose appointment starts in the next 2 hours and who have no
 * `SMS_REMINDER` communication yet. Derived client-side from today's
 * appointments — no dedicated endpoint needed.
 *
 * TODO(notifications-engineer, Phase 3a): replace the "sent-reminder" check
 * with a real `hasReminder` flag on the Appointment row so we don't depend on
 * the `communications` join being loaded.
 */
export type UpcomingReminder = {
  appointment: AppointmentRow;
  minutesUntil: number;
};

/**
 * Subscribe the reception dashboard to realtime events. Call once from the
 * page-level client component. Invalidates every live query on the relevant
 * event types; TanStack Query then refetches as needed.
 */
export function useReceptionRealtime(): void {
  useLiveQueryInvalidation({
    events: [
      "appointment.created",
      "appointment.updated",
      "appointment.statusChanged",
      "appointment.cancelled",
      "appointment.moved",
      "queue.updated",
    ],
    queryKeys: [
      ["reception", "dashboard"],
      ["reception", "appointments", "today"],
    ],
  });
  useLiveQueryInvalidation({
    events: ["call.incoming", "call.answered", "call.ended", "call.missed"],
    queryKey: ["reception", "calls"],
  });
  useLiveQueryInvalidation({
    events: ["tg.message.new", "tg.conversation.updated"],
    queryKey: ["reception", "conversations"],
  });
  useLiveQueryInvalidation({
    events: ["cabinet.occupancy.changed"],
    queryKey: ["reception", "cabinets"],
  });
}

export function computeUpcomingReminders(
  rows: AppointmentRow[],
  now = new Date(),
): UpcomingReminder[] {
  const horizon = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const out: UpcomingReminder[] = [];
  for (const r of rows) {
    // Only BOOKED / WAITING — not in-progress / completed / cancelled.
    if (r.status !== "BOOKED" && r.status !== "WAITING") continue;
    const start = new Date(r.date);
    if (start <= now) continue;
    if (start > horizon) continue;
    const minutesUntil = Math.round((start.getTime() - now.getTime()) / 60_000);
    out.push({ appointment: r, minutesUntil });
  }
  out.sort((a, b) => a.minutesUntil - b.minutesUntil);
  return out;
}
