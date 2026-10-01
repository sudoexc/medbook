"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useMiniAppFetch } from "./use-miniapp-api";

/**
 * The patient's own data rights: export, deletion request, cancellation.
 *
 * Every call goes through `useMiniAppFetch` (audit MA-12). The screens used
 * to call `fetch` by hand without `?clinicSlug=`, and the Mini App handler
 * answers 400 `missing_clinic_slug` to that: «Скачать мои данные»,
 * «Удалить аккаунт» and «Отменить удаление» had never worked once.
 */

export type DeletionPending = { jobId: string; scheduledFor: string };

const deletionKey = (clinicSlug: string) =>
  ["miniapp", "account-deletion", clinicSlug] as const;

/** The active deletion request, read from the server on every visit. */
export function useDeletionStatus() {
  const { request, clinicSlug } = useMiniAppFetch();
  return useQuery<DeletionPending | null>({
    queryKey: deletionKey(clinicSlug),
    queryFn: async () => {
      const body = await request<{ pending: DeletionPending | null }>(
        "/api/miniapp/account/delete",
      );
      return body.pending;
    },
  });
}

export function useRequestDeletion() {
  const qc = useQueryClient();
  const { request, clinicSlug } = useMiniAppFetch();
  return useMutation({
    mutationFn: async (body: {
      reason?: string;
      notes?: string;
      confirmation: string;
    }) =>
      request<{ jobId: string; scheduledFor: string; reused: boolean }>(
        "/api/miniapp/account/delete",
        { method: "POST", body: JSON.stringify(body) },
      ),
    onSuccess: (res) => {
      qc.setQueryData<DeletionPending | null>(deletionKey(clinicSlug), {
        jobId: res.jobId,
        scheduledFor: res.scheduledFor,
      });
    },
  });
}

export function useCancelDeletion() {
  const qc = useQueryClient();
  const { request, clinicSlug } = useMiniAppFetch();
  return useMutation({
    mutationFn: async () =>
      request<{ jobId: string; status: string }>(
        "/api/miniapp/account/cancel-deletion",
        { method: "POST", body: JSON.stringify({}) },
      ),
    onSuccess: () => {
      qc.setQueryData<DeletionPending | null>(deletionKey(clinicSlug), null);
    },
    // A 404 means there is nothing left to cancel (already cancelled or
    // executed): re-read rather than keep showing a dead «cancel» button.
    onError: () => {
      void qc.invalidateQueries({ queryKey: deletionKey(clinicSlug) });
    },
  });
}

export function useRequestExport() {
  const { request } = useMiniAppFetch();
  return useMutation({
    mutationFn: async () =>
      request<{ reused?: boolean }>("/api/miniapp/account/export", {
        method: "POST",
        body: JSON.stringify({}),
      }),
  });
}
