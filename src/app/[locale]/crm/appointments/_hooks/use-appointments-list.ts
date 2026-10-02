"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";

import { useLiveEvents } from "@/hooks/use-live-events";
import { isOverdue, isRunningLate } from "@/lib/appointments/overdue";
import {
  ARRIVED_STATUSES,
  SOON_STATUSES,
  SOON_WINDOW_MIN,
} from "@/lib/appointments/list-tiles";

/**
 * Denormalised row returned by `GET /api/crm/appointments` — see §6.2.
 *
 * The server `include`s patient / doctor / cabinet / primaryService /
 * payments / services, so the client never needs a second hop per row.
 */
export type AppointmentPatientShort = {
  id: string;
  fullName: string;
  phone: string;
  photoUrl: string | null;
};

export type AppointmentDoctorShort = {
  id: string;
  nameRu: string;
  nameUz: string;
  photoUrl: string | null;
  color: string | null;
};

export type AppointmentCabinetShort = {
  id: string;
  number: string;
};

export type AppointmentServiceShort = {
  id: string;
  nameRu: string;
  nameUz: string;
};

export type AppointmentServiceLineShort = {
  serviceId: string;
  quantity: number;
  priceSnap: number;
  service: {
    id: string;
    nameRu: string;
    nameUz: string;
    priceBase: number;
  };
};

export type AppointmentPaymentShort = {
  id: string;
  amount: number;
  status: "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED";
  method: string | null;
};

export type AppointmentRow = {
  id: string;
  date: string;
  time: string | null;
  endDate: string;
  durationMin: number;
  status:
    | "BOOKED"
    | "CONFIRMED"
    | "WAITING"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "SKIPPED"
    | "CANCELLED"
    | "NO_SHOW";
  queueStatus:
    | "BOOKED"
    | "CONFIRMED"
    | "WAITING"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "SKIPPED"
    | "CANCELLED"
    | "NO_SHOW";
  channel: "WALKIN" | "PHONE" | "TELEGRAM" | "WEBSITE" | "KIOSK";
  queueOrder: number | null;
  queuePriority: number;
  ticketSeq: number | null;
  queuedAt: string | null;
  /**
   * Mini App «Я на месте» (G3-01). The list API returns every scalar column;
   * optional so a row built by hand (tests, optimistic writes) still types.
   */
  arrivedAt?: string | null;
  priceBase: number | null;
  priceService: number | null;
  priceFinal: number | null;
  discountPct: number;
  discountAmount: number;
  comments: string | null;
  notes: string | null;
  cancelReason: string | null;
  confirmedAt: string | null;
  confirmedVia:
    | "BOOKING_AUTO"
    | "MANUAL_CRM"
    | "SMS_REPLY"
    | "TG_BUTTON"
    | "INBOUND_CALL"
    | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  patient: AppointmentPatientShort;
  doctor: AppointmentDoctorShort;
  cabinet: AppointmentCabinetShort | null;
  primaryService: AppointmentServiceShort | null;
  services: AppointmentServiceLineShort[];
  payments: AppointmentPaymentShort[];
  /**
   * Set only on today's NO_SHOW rows the lifecycle sweep marked and nobody
   * has touched since: reception may still check such a patient in
   * (`canArriveAfterAutoNoShow`).
   */
  autoNoShow?: boolean;
};


export type AppointmentsListResponse = {
  rows: AppointmentRow[];
  nextCursor: string | null;
  total: number;
  tally: Record<string, number>;
};

export type AppointmentsListFilters = {
  from?: string;
  to?: string;
  doctorId?: string;
  patientId?: string;
  cabinetId?: string;
  status?: string;
  channel?: string;
  serviceId?: string;
  onlyUnpaid?: boolean;
  q?: string;
  sort?: "date" | "createdAt";
  dir?: "asc" | "desc";
};

function buildSearch(
  filters: AppointmentsListFilters,
  cursor?: string,
  limit = 50,
): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.doctorId) params.set("doctorId", filters.doctorId);
  if (filters.patientId) params.set("patientId", filters.patientId);
  if (filters.cabinetId) params.set("cabinetId", filters.cabinetId);
  if (filters.status) params.set("status", filters.status);
  if (filters.channel) params.set("channel", filters.channel);
  if (filters.serviceId) params.set("serviceId", filters.serviceId);
  if (filters.onlyUnpaid) params.set("unpaid", "true");
  if (filters.q) params.set("q", filters.q);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.dir) params.set("dir", filters.dir);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));
  return params.toString();
}

export function appointmentsListKey(filters: AppointmentsListFilters) {
  return ["appointments", "list", filters] as const;
}

export function useAppointmentsList(
  filters: AppointmentsListFilters,
  limit = 50,
) {
  return useInfiniteQuery<
    AppointmentsListResponse,
    Error,
    { pages: AppointmentsListResponse[]; pageParams: (string | undefined)[] },
    ReturnType<typeof appointmentsListKey>,
    string | undefined
  >({
    queryKey: appointmentsListKey(filters),
    initialPageParam: undefined,
    queryFn: async ({ pageParam, signal }) => {
      const qs = buildSearch(filters, pageParam, limit);
      const res = await fetch(`/api/crm/appointments?${qs}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) {
        throw new Error(`Failed to load appointments: ${res.status}`);
      }
      return (await res.json()) as AppointmentsListResponse;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/**
 * Subscribe the appointments list to SSE `appointment.*` events. Call once
 * from the page-level client component. Every cached `["appointments","list",...]`
 * key gets invalidated on any relevant event.
 */
export function useAppointmentsRealtime(): void {
  const qc = useQueryClient();
  useLiveEvents(
    () => {
      void qc.invalidateQueries({ queryKey: ["appointments", "list"] });
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

/**
 * Flatten infinite-query pages to a single array. Memoisation is the caller's
 * responsibility — identity is stable as long as the query cache doesn't refetch.
 */
export function flattenAppointments(
  data: { pages: AppointmentsListResponse[] } | undefined,
): AppointmentRow[] {
  if (!data) return [];
  const out: AppointmentRow[] = [];
  for (const p of data.pages) out.push(...p.rows);
  return out;
}

/**
 * Client-side narrowing for UX-only tile buckets that don't translate to a
 * single API status. Returns the same array reference when `bucket` doesn't
 * trigger any filtering so React.useMemo callers stay cheap.
 */
export function filterRowsByBucket(
  rows: AppointmentRow[],
  bucket: string | null | undefined,
  now = new Date(),
): AppointmentRow[] {
  if (!bucket || bucket === "all") return rows;
  const nowMs = now.getTime();
  const soonMs = SOON_WINDOW_MIN * 60 * 1000;
  switch (bucket) {
    case "needs_attention":
      return rows.filter(
        (r) => r.status === "WAITING" || isOverdue(r, nowMs),
      );
    case "soon":
      return rows.filter((r) => {
        const startMs = new Date(r.date).getTime();
        return (
          (SOON_STATUSES as readonly string[]).includes(r.status) &&
          startMs - nowMs >= 0 &&
          startMs - nowMs <= soonMs
        );
      });
    case "unconfirmed":
      return rows.filter((r) => r.status === "BOOKED");
    case "late":
      return rows.filter((r) => isRunningLate(r, nowMs));
    case "overdue":
      return rows.filter((r) => isOverdue(r, nowMs));
    case "arrived":
      return rows.filter((r) =>
        (ARRIVED_STATUSES as readonly string[]).includes(r.status),
      );
    default:
      return rows;
  }
}

/**
 * Resolve the effective payment status for a row: PAID if any PAID payment
 * covers the final price, PARTIAL if partial payments exist, UNPAID otherwise.
 */
export function paymentStatusFor(
  row: AppointmentRow,
): "PAID" | "PARTIAL" | "UNPAID" {
  const paidSum = row.payments
    .filter((p) => p.status === "PAID")
    .reduce((acc, p) => acc + p.amount, 0);
  const target = row.priceFinal ?? 0;
  if (target > 0 && paidSum >= target) return "PAID";
  if (paidSum > 0) return "PARTIAL";
  return "UNPAID";
}
