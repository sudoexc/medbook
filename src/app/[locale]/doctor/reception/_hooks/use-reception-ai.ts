"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

export type ClarifyingResponse = {
  questions: string[];
  fromFallback: boolean;
};

export type Icd10Suggestion = {
  code: string;
  nameRu: string;
  tone: "likely" | "possible";
};

export type Icd10SuggestResponse = {
  suggestions: Icd10Suggestion[];
  fromFallback: boolean;
};

export type BuildConclusionResponse = {
  markdown: string;
  fromFallback: boolean;
};

export type ReceptionWarning = {
  id: string;
  text: string;
  tone: "info" | "warn" | "alert";
};

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Lazy fetch — the rail starts empty and the doctor presses "Обновить"
 * to fire the LLM. Returns mutation so we can drive it from a button.
 */
export function useClarifyingQuestions() {
  return useMutation<ClarifyingResponse, Error, { noteId: string; locale?: "ru" | "uz" }>({
    mutationFn: ({ noteId, locale }) =>
      postJSON<ClarifyingResponse>("/api/crm/ai/clarifying-questions", {
        noteId,
        locale: locale ?? "ru",
      }),
  });
}

export function useIcd10Suggest() {
  return useMutation<Icd10SuggestResponse, Error, { noteId: string; locale?: "ru" | "uz" }>({
    mutationFn: ({ noteId, locale }) =>
      postJSON<Icd10SuggestResponse>("/api/crm/ai/icd10-suggest", {
        noteId,
        locale: locale ?? "ru",
      }),
  });
}

export function useBuildConclusion() {
  return useMutation<BuildConclusionResponse, Error, { noteId: string; locale?: "ru" | "uz" }>({
    mutationFn: ({ noteId, locale }) =>
      postJSON<BuildConclusionResponse>("/api/crm/ai/build-conclusion", {
        noteId,
        locale: locale ?? "ru",
      }),
  });
}

/** Warnings — cheap, deterministic; fetch every time the note changes. */
export function useReceptionWarnings(noteId: string | null) {
  return useQuery<{ warnings: ReceptionWarning[] }>({
    queryKey: ["doctor", "reception", "warnings", noteId],
    enabled: !!noteId,
    queryFn: async ({ signal }) => {
      const url = `/api/crm/ai/warnings?noteId=${encodeURIComponent(noteId!)}`;
      const res = await fetch(url, { credentials: "include", signal });
      if (!res.ok) throw new Error(`warnings ${res.status}`);
      return (await res.json()) as { warnings: ReceptionWarning[] };
    },
    staleTime: 10_000,
  });
}
