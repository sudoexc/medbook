"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";

import { useLiveEvents } from "@/hooks/use-live-events";
import { isOverdue, isRunningLate } from "@/lib/appointments/overdue";
import { compareQueue } from "@/lib/queue-ordering";

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
};

/**
 * Live-queue precedence shared by every reception sort site (panel, doctor
 * list, queue column). Thin adapter over the single source of truth
 * `compareQueue` (`lib/queue-ordering`) so the staff panel sorts byte-for-byte
 * like the server projection that drives the TV board / kiosk / patient ticket:
 * urgency bump first, then serveAt (EDF), then the immutable ticket sequence.
 * Callers may still append a tie-breaker, but with serveAt as the key a true
 * tie is now rare.
 */
export function compareQueuePriority(
  a: Pick<
    AppointmentRow,
    "queuePriority" | "queueOrder" | "ticketSeq" | "channel" | "date" | "queuedAt"
  >,
  b: Pick<
    AppointmentRow,
    "queuePriority" | "queueOrder" | "ticketSeq" | "channel" | "date" | "queuedAt"
  >,
): number {
  return compareQueue(a, b);
}

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
 * Business-focused counts for the top tiles / smart tabs on the Записи page.
 *
 * - `needsAttention` — WAITING rows **or** any overdue row (status
 *   BOOKED/CONFIRMED/SKIPPED whose end time has passed beyond the grace).
 * - `soon` — BOOKED/CONFIRMED rows starting within the next 15 minutes.
 * - `unconfirmed` — BOOKED rows (CONFIRMED is its own state now).
 * - `late` — running-late rows (start passed, end window still open) for
 *   pre-arrival statuses.
 * - `overdue` — rows past their end window without resolution; the receptionist
 *   needs to decide arrive/no-show/reschedule.
 * - `arrived` — IN_PROGRESS or COMPLETED rows.
 * - `needsCall` — BOOKED rows arriving via PHONE/TELEGRAM without any payment yet.
 * - `riskNoShow` — NO_SHOW + overdue + running-late non-walkin rows.
 */
export function tallyBuckets(
  rows: AppointmentRow[],
  now = new Date(),
): {
  all: number;
  needsAttention: number;
  soon: number;
  unconfirmed: number;
  late: number;
  overdue: number;
  arrived: number;
  needsCall: number;
  riskNoShow: number;
} {
  const nowMs = now.getTime();
  const fifteenMin = 15 * 60 * 1000;
  let needsAttention = 0;
  let soon = 0;
  let unconfirmed = 0;
  let late = 0;
  let overdue = 0;
  let arrived = 0;
  let needsCall = 0;
  let riskNoShow = 0;
  for (const r of rows) {
    const startMs = new Date(r.date).getTime();
    const rowIsOverdue = isOverdue(r, nowMs);
    const rowIsLate = isRunningLate(r, nowMs);
    const isSoon =
      (r.status === "BOOKED" || r.status === "CONFIRMED") &&
      startMs - nowMs >= 0 &&
      startMs - nowMs <= fifteenMin;
    if (r.status === "WAITING" || rowIsOverdue) needsAttention += 1;
    if (isSoon) soon += 1;
    if (r.status === "BOOKED") unconfirmed += 1;
    if (rowIsLate) late += 1;
    if (rowIsOverdue) overdue += 1;
    if (r.status === "IN_PROGRESS" || r.status === "COMPLETED") arrived += 1;
    if (
      r.status === "BOOKED" &&
      (r.channel === "PHONE" || r.channel === "TELEGRAM") &&
      r.payments.length === 0
    ) {
      needsCall += 1;
    }
    if (
      r.status === "NO_SHOW" ||
      rowIsOverdue ||
      (rowIsLate && r.channel !== "WALKIN")
    ) {
      riskNoShow += 1;
    }
  }
  return {
    all: rows.length,
    needsAttention,
    soon,
    unconfirmed,
    late,
    overdue,
    arrived,
    needsCall,
    riskNoShow,
  };
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
  const fifteenMin = 15 * 60 * 1000;
  switch (bucket) {
    case "needs_attention":
      return rows.filter(
        (r) => r.status === "WAITING" || isOverdue(r, nowMs),
      );
    case "soon":
      return rows.filter((r) => {
        const startMs = new Date(r.date).getTime();
        return (
          (r.status === "BOOKED" || r.status === "CONFIRMED") &&
          startMs - nowMs >= 0 &&
          startMs - nowMs <= fifteenMin
        );
      });
    case "unconfirmed":
      return rows.filter((r) => r.status === "BOOKED");
    case "late":
      return rows.filter((r) => isRunningLate(r, nowMs));
    case "overdue":
      return rows.filter((r) => isOverdue(r, nowMs));
    case "arrived":
      return rows.filter(
        (r) => r.status === "IN_PROGRESS" || r.status === "COMPLETED",
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
