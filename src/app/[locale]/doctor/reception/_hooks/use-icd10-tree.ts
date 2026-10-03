"use client";

/**
 * One level of the ICD-10 tree (a chapter or a block) for the diagnosis
 * picker's «Каталог МКБ» column, see /api/crm/icd10/tree. Static reference
 * data: kept for the whole session once read.
 */
import { useQuery } from "@tanstack/react-query";

export type Icd10NodeBlock = { range: string; nameRu: string; count: number };
export type Icd10NodeRow = { code: string; nameRu: string };

export type Icd10Node = {
  range: string;
  blocks: Icd10NodeBlock[];
  rows: Icd10NodeRow[];
  headings: Icd10NodeRow[];
};

export function useIcd10Node(range: string | null) {
  return useQuery<Icd10Node>({
    queryKey: ["icd10", "tree", range ?? ""],
    enabled: !!range,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/icd10/tree?node=${encodeURIComponent(range ?? "")}`,
        { credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`icd10 tree ${res.status}`);
      return (await res.json()) as Icd10Node;
    },
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });
}
