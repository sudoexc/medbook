"use client";

/**
 * The drugs of one ATC subgroup («N03»), for the prescription picker's
 * «Каталог» column: alphabetical, a page at a time, through the same list
 * endpoint (and so the same clinic visibility and overlay) as every search.
 */
import {
  useInfiniteQuery,
  type InfiniteData,
} from "@tanstack/react-query";

import type { DrugSearchHit } from "./use-drug-search";

/** One screenful of a column and then some; «Показать ещё» loads the next. */
export const ATC_PAGE_SIZE = 60;

type Page = { rows: DrugSearchHit[]; total: number; offset: number };

export function useAtcDrugs(atc: string | null) {
  return useInfiniteQuery<
    Page,
    Error,
    InfiniteData<Page>,
    readonly unknown[],
    number
  >({
    queryKey: ["doctor", "reception", "atc-drugs", atc ?? ""],
    enabled: !!atc,
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        atc: atc ?? "",
        limit: String(ATC_PAGE_SIZE),
        offset: String(pageParam),
      });
      const res = await fetch(`/api/crm/catalogs/drugs?${params.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`atc drugs ${res.status}`);
      const j = (await res.json()) as Partial<Page>;
      return {
        rows: j.rows ?? [],
        total: j.total ?? 0,
        offset: j.offset ?? pageParam,
      };
    },
    getNextPageParam: (last) => {
      const next = last.offset + ATC_PAGE_SIZE;
      return next < last.total ? next : undefined;
    },
    // The catalog changes over weeks; a doctor walks back and forth between
    // subgroups during one visit and must not wait for the same list twice.
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
}
