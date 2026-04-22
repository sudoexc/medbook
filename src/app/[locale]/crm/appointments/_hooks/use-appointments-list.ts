"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

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
    | "WAITING"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "SKIPPED"
    | "CANCELLED"
    | "NO_SHOW";
  queueStatus:
    | "BOOKED"
    | "WAITING"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "SKIPPED"
    | "CANCELLED"
    | "NO_SHOW";
  channel: "WALKIN" | "PHONE" | "TELEGRAM" | "WEBSITE" | "KIOSK";
  priceBase: number | null;
  priceService: number | null;
  priceFinal: number | null;
  discountPct: number;
  discountAmount: number;
  comments: string | null;
  notes: string | null;
  cancelReason: string | null;
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

export type AppointmentsListResponse = {
  rows: AppointmentRow[];
  nextCursor: string | null;
  total: number;
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
    queryFn: async ({ pageParam }) => {
      const qs = buildSearch(filters, pageParam, limit);
      const res = await fetch(`/api/crm/appointments?${qs}`, {
        credentials: "include",
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
 * Tally row statuses client-side so the KPI strip doesn't need its own endpoint.
 * Pragmatic: only covers the rows already loaded. Page-level KPI that counts
 * across the whole filter set is a TODO for api-builder (Phase 2b wrap-up).
 */
export function tallyStatuses(rows: AppointmentRow[]): Record<string, number> {
  const t: Record<string, number> = {
    all: rows.length,
    WAITING: 0,
    BOOKED: 0,
    IN_PROGRESS: 0,
    COMPLETED: 0,
    CANCELLED: 0,
    NO_SHOW: 0,
    SKIPPED: 0,
  };
  for (const r of rows) {
    t[r.status] = (t[r.status] ?? 0) + 1;
  }
  return t;
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
