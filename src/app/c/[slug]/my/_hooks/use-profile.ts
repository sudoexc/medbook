"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMiniAppFetch } from "./use-miniapp-api";
import { useMiniAppAuth } from "../_components/miniapp-auth-provider";

export type MiniAppProfile = {
  id: string;
  fullName: string;
  phone: string;
  phoneNormalized: string;
  preferredLang: "RU" | "UZ";
  consentMarketing: boolean;
  telegramUsername: string | null;
  hasPhone: boolean;
};

export function useProfile() {
  const { request, clinicSlug } = useMiniAppFetch();
  return useQuery<MiniAppProfile>({
    queryKey: ["miniapp", "profile", clinicSlug],
    queryFn: async ({ signal }) => {
      const body = await request<{ patient: MiniAppProfile }>(
        "/api/miniapp/profile",
      );
      return body.patient;
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  const { request, clinicSlug } = useMiniAppFetch();
  const { updatePatient } = useMiniAppAuth();
  return useMutation({
    mutationFn: async (body: {
      fullName?: string;
      phone?: string;
      lang?: "RU" | "UZ";
      consentMarketing?: boolean;
    }) => {
      const res = await request<{ patient: MiniAppProfile }>(
        "/api/miniapp/profile",
        { method: "POST", body: JSON.stringify(body) },
      );
      return res.patient;
    },
    onSuccess: (patient) => {
      qc.invalidateQueries({ queryKey: ["miniapp", "profile", clinicSlug] });
      updatePatient({
        fullName: patient.fullName,
        phone: patient.phone,
        preferredLang: patient.preferredLang,
        hasPhone: patient.hasPhone,
      });
    },
  });
}
