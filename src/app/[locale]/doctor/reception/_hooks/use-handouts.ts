"use client";

import { useQuery } from "@tanstack/react-query";

export type HandoutTemplateRow = {
  id: string;
  code: string;
  titleRu: string;
  titleUz: string | null;
  summaryRu: string | null;
  bodyMd: string;
  bodyMdUz: string | null;
  matchPrefixes: string[];
  topic: string | null;
  sortOrder: number;
  /** Highest rank — matches the current diagnosis prefix. */
  matched: boolean;
  /** Second rank — no matchPrefixes (general handout). */
  general: boolean;
};

type Response = {
  templates: HandoutTemplateRow[];
  total: number;
};

async function fetchHandouts({
  q,
  dxCode,
}: {
  q: string;
  dxCode: string | null;
}): Promise<Response> {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (dxCode && dxCode.trim()) params.set("dxCode", dxCode.trim());
  const res = await fetch(`/api/crm/catalogs/handouts?${params.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) return { templates: [], total: 0 };
  return (await res.json()) as Response;
}

export function useHandouts(q: string, dxCode: string | null) {
  return useQuery({
    queryKey: ["handouts", q, dxCode ?? ""],
    queryFn: () => fetchHandouts({ q, dxCode }),
    staleTime: 60_000,
  });
}
