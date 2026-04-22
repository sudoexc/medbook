"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

/**
 * Server row shape returned by `GET /api/crm/patients`.
 * Mirrors the Prisma `Patient` model (the fields the list view actually needs).
 * Kept local so the client bundle never pulls in Prisma types.
 */
export type PatientRow = {
  id: string;
  fullName: string;
  phone: string;
  phoneNormalized: string;
  birthDate: string | null;
  gender: "MALE" | "FEMALE" | null;
  photoUrl: string | null;
  segment: "NEW" | "ACTIVE" | "DORMANT" | "VIP" | "CHURN";
  source:
    | "WEBSITE"
    | "TELEGRAM"
    | "INSTAGRAM"
    | "CALL"
    | "WALKIN"
    | "REFERRAL"
    | "ADS"
    | "OTHER"
    | null;
  tags: string[];
  ltv: number;
  balance: number;
  visitsCount: number;
  lastVisitAt: string | null;
  nextVisitAt: string | null;
  telegramUsername: string | null;
  passport: string | null;
  createdAt: string;
};

export type PatientsListResponse = {
  rows: PatientRow[];
  nextCursor: string | null;
  total: number;
};

export type PatientsListFilters = {
  q?: string;
  segment?: string;
  source?: string;
  gender?: string;
  tag?: string;
  balance?: "debt" | "zero" | "credit";
  registeredFrom?: string;
  registeredTo?: string;
  sort?: "createdAt" | "lastVisitAt" | "visitsCount" | "ltv" | "fullName";
  dir?: "asc" | "desc";
};

function buildSearch(
  filters: PatientsListFilters,
  cursor?: string,
  limit = 50,
): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.segment) params.set("segment", filters.segment);
  if (filters.source) params.set("source", filters.source);
  if (filters.gender) params.set("gender", filters.gender);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.balance) params.set("balance", filters.balance);
  if (filters.registeredFrom) params.set("registeredFrom", filters.registeredFrom);
  if (filters.registeredTo) params.set("registeredTo", filters.registeredTo);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.dir) params.set("dir", filters.dir);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));
  return params.toString();
}

export function patientsListKey(filters: PatientsListFilters) {
  return ["patients", "list", filters] as const;
}

export function usePatientsList(filters: PatientsListFilters, limit = 50) {
  return useInfiniteQuery<
    PatientsListResponse,
    Error,
    { pages: PatientsListResponse[]; pageParams: (string | undefined)[] },
    ReturnType<typeof patientsListKey>,
    string | undefined
  >({
    queryKey: patientsListKey(filters),
    initialPageParam: undefined,
    queryFn: async ({ pageParam }) => {
      const qs = buildSearch(filters, pageParam, limit);
      const res = await fetch(`/api/crm/patients?${qs}`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Failed to load patients: ${res.status}`);
      }
      return (await res.json()) as PatientsListResponse;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/**
 * Flatten infinite-query pages to a single `rows` array. Safe to call on the
 * render path — memoised via identity of the `data` object from useQuery.
 */
export function flattenPatients(
  data: { pages: PatientsListResponse[] } | undefined,
): PatientRow[] {
  if (!data) return [];
  const out: PatientRow[] = [];
  for (const p of data.pages) out.push(...p.rows);
  return out;
}
