"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * `GET /api/crm/doctors/[id]` — doctor row plus `services`, `schedules`,
 * upcoming `timeOffs`. Kept local so the client bundle doesn't pull Prisma.
 */
export type DoctorServiceLink = {
  doctorId: string;
  serviceId: string;
  priceOverride: number | null;
  service: {
    id: string;
    nameRu: string;
    nameUz: string;
    priceBase: number;
    durationMin: number;
    category: string | null;
  };
};

export type DoctorScheduleEntry = {
  id: string;
  doctorId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  cabinetId: string | null;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
};

export type DoctorTimeOffEntry = {
  id: string;
  doctorId: string;
  startAt: string;
  endAt: string;
  reason: string | null;
};

export type DoctorDetail = {
  id: string;
  clinicId: string;
  userId: string | null;
  slug: string;
  nameRu: string;
  nameUz: string;
  specializationRu: string;
  specializationUz: string;
  photoUrl: string | null;
  bioRu: string | null;
  bioUz: string | null;
  rating: number | string | null;
  reviewCount: number;
  color: string;
  pricePerVisit: number | null;
  salaryPercent: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  services: DoctorServiceLink[];
  schedules: DoctorScheduleEntry[];
  timeOffs: DoctorTimeOffEntry[];
};

export type DoctorUpdateInput = Partial<{
  nameRu: string;
  nameUz: string;
  specializationRu: string;
  specializationUz: string;
  photoUrl: string | null;
  bioRu: string | null;
  bioUz: string | null;
  color: string;
  pricePerVisit: number | null;
  salaryPercent: number;
  isActive: boolean;
}>;

export const doctorKey = (id: string) => ["doctor", id] as const;

export function useDoctor(id: string) {
  return useQuery<DoctorDetail, Error>({
    queryKey: doctorKey(id),
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/doctors/${id}`, {
        credentials: "include",
        signal,
      });
      if (res.status === 404) throw new Error("NOT_FOUND");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as DoctorDetail;
    },
    retry: (count, err) => err.message !== "NOT_FOUND" && count < 2,
    staleTime: 30_000,
  });
}

export function usePatchDoctor(id: string) {
  const qc = useQueryClient();
  return useMutation<DoctorDetail, Error, DoctorUpdateInput, { prev?: DoctorDetail }>({
    mutationFn: async (patch) => {
      const res = await fetch(`/api/crm/doctors/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as DoctorDetail;
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: doctorKey(id) });
      const prev = qc.getQueryData<DoctorDetail>(doctorKey(id));
      if (prev) {
        qc.setQueryData<DoctorDetail>(doctorKey(id), {
          ...prev,
          ...patch,
        } as DoctorDetail);
      }
      return { prev };
    },
    onError: (err, _patch, context) => {
      if (context?.prev) qc.setQueryData(doctorKey(id), context.prev);
      toast.error(err.message || "Не удалось сохранить");
    },
    onSuccess: (fresh) => {
      qc.setQueryData<DoctorDetail>(doctorKey(id), (prev) =>
        prev ? { ...prev, ...fresh } : fresh,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: doctorKey(id) });
      qc.invalidateQueries({ queryKey: ["doctors", "list"] });
    },
  });
}
