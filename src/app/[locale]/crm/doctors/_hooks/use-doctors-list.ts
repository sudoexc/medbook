"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

/**
 * Doctor row shape returned by `GET /api/crm/doctors`.
 * Mirrors `Doctor` Prisma model fields that the list grid actually renders.
 * Kept local so the client bundle never pulls Prisma types.
 */
export type DoctorRow = {
  id: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  specializationRu: string;
  specializationUz: string;
  photoUrl: string | null;
  bioRu: string | null;
  bioUz: string | null;
  color: string;
  rating: number | string | null;
  reviewCount: number;
  pricePerVisit: number | null;
  salaryPercent: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DoctorsListResponse = {
  rows: DoctorRow[];
  nextCursor: string | null;
};

export type DoctorsListFilters = {
  q?: string;
  specialization?: string;
  isActive?: boolean;
};

function buildSearch(
  filters: DoctorsListFilters,
  cursor?: string,
  limit = 100,
): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.specialization) params.set("specialization", filters.specialization);
  if (typeof filters.isActive === "boolean")
    params.set("isActive", String(filters.isActive));
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));
  return params.toString();
}

export function doctorsListKey(filters: DoctorsListFilters) {
  return ["doctors", "list", filters] as const;
}

export function useDoctorsList(filters: DoctorsListFilters, limit = 100) {
  return useInfiniteQuery<
    DoctorsListResponse,
    Error,
    { pages: DoctorsListResponse[]; pageParams: (string | undefined)[] },
    ReturnType<typeof doctorsListKey>,
    string | undefined
  >({
    queryKey: doctorsListKey(filters),
    initialPageParam: undefined,
    queryFn: async ({ pageParam }) => {
      const qs = buildSearch(filters, pageParam, limit);
      const res = await fetch(`/api/crm/doctors?${qs}`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Failed to load doctors: ${res.status}`);
      }
      return (await res.json()) as DoctorsListResponse;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}

export function flattenDoctors(
  data: { pages: DoctorsListResponse[] } | undefined,
): DoctorRow[] {
  if (!data) return [];
  const out: DoctorRow[] = [];
  for (const p of data.pages) out.push(...p.rows);
  return out;
}
