"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useMiniAppFetch } from "./use-miniapp-api";

export type FamilyPatient = {
  id: string;
  fullName: string;
  phone: string;
  birthDate: string | null;
  gender: "MALE" | "FEMALE" | null;
};

export type FamilyMember = {
  linkId: string;
  relationship: "child" | "spouse" | "parent" | "other";
  patient: FamilyPatient;
  createdAt: string;
};

export type FamilyResponse = {
  self: FamilyPatient;
  members: FamilyMember[];
  max: number;
};

export function useFamily() {
  const { request, clinicSlug } = useMiniAppFetch();
  return useQuery<FamilyResponse>({
    queryKey: ["miniapp", "family", clinicSlug],
    queryFn: async () => request<FamilyResponse>("/api/miniapp/family"),
  });
}

export function useAddFamilyMember() {
  const qc = useQueryClient();
  const { request, clinicSlug } = useMiniAppFetch();
  return useMutation({
    mutationFn: async (body: {
      fullName: string;
      phone?: string;
      birthDate?: string;
      gender?: "MALE" | "FEMALE";
      relationship: "child" | "spouse" | "parent" | "other";
    }) => {
      return request<{
        member: FamilyMember;
        createdNew: boolean;
      }>("/api/miniapp/family", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["miniapp", "family", clinicSlug] });
    },
  });
}

export function useUnlinkFamilyMember() {
  const qc = useQueryClient();
  const { request, clinicSlug } = useMiniAppFetch();
  return useMutation({
    mutationFn: async (linkedPatientId: string) => {
      return request<{ ok: true }>(
        `/api/miniapp/family/${encodeURIComponent(linkedPatientId)}`,
        { method: "DELETE" },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["miniapp", "family", clinicSlug] });
    },
  });
}
