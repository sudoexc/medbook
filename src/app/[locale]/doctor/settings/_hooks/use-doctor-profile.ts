"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type DoctorProfile = {
  id: string;
  email: string;
  role: string;
  clinicId: string | null;
  createdAt: string;
  name: string;
  phone: string | null;
  photoUrl: string | null;
  doctorId: string;
  nameRu: string;
  nameUz: string;
  specializationRu: string;
  specializationUz: string;
  bioRu: string | null;
  bioUz: string | null;
  signatureUrl: string | null;
};

export const doctorProfileKey = ["doctor", "me", "profile"] as const;

export function useDoctorProfile() {
  return useQuery<DoctorProfile, Error>({
    queryKey: doctorProfileKey,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/doctors/me/profile", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`profile: ${res.status}`);
      return (await res.json()) as DoctorProfile;
    },
    staleTime: 60_000,
  });
}

export type ProfilePatch = Partial<{
  name: string;
  phone: string | null;
  photoUrl: string | null;
  nameRu: string;
  nameUz: string;
  specializationRu: string;
  specializationUz: string;
  bioRu: string | null;
  bioUz: string | null;
}>;

export function usePatchDoctorProfile() {
  const qc = useQueryClient();
  return useMutation<void, Error, ProfilePatch>({
    mutationFn: async (patch) => {
      const res = await fetch("/api/crm/doctors/me/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`profile PATCH: ${res.status}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: doctorProfileKey });
    },
  });
}

export function useSetDoctorSignature() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (signatureUrl) => {
      const res = await fetch("/api/crm/doctors/me/signature", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signatureUrl }),
      });
      if (!res.ok) throw new Error(`signature PUT: ${res.status}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: doctorProfileKey });
    },
  });
}

export function useRemoveDoctorSignature() {
  const qc = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      const res = await fetch("/api/crm/doctors/me/signature", {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`signature DELETE: ${res.status}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: doctorProfileKey });
    },
  });
}
