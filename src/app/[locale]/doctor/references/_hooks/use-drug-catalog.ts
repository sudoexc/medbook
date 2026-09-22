"use client";

import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";

import type { DrugDetail } from "../../_components/drug-detail";

type Response = { rows: DrugDetail[]; total: number; offset: number };

export type DrugCatalogPage = {
  rows: DrugDetail[];
  /** Matches in the database for this query, before paging. */
  total: number;
  offset: number;
};

/** Rows per request — the API's own ceiling. */
export const DRUG_PAGE_SIZE = 200;

/**
 * Paged drug lookup for the reference browser.
 *
 * This used to fetch the whole catalog once («~160 rows, limit=200 covers
 * it») and filter in the browser. After the state-register import the
 * catalog holds ~2.7k drugs, so that request silently truncated: a doctor
 * searching for anything past the cut got «ничего не найдено» while the drug
 * sat in the database, and there was no way to reach the rest at all.
 *
 * Now: search runs on the server (which also ranks by INN / brand / prefix)
 * and the browser pages through everything with «Показать ещё».
 */
export function useDrugCatalog(term: string) {
  const q = term.trim();
  return useInfiniteQuery<
    DrugCatalogPage,
    Error,
    InfiniteData<DrugCatalogPage>,
    readonly unknown[],
    number
  >({
    queryKey: ["doctor", "references", "drug-catalog", q],
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const url = new URL("/api/crm/catalogs/drugs", window.location.origin);
      url.searchParams.set("limit", String(DRUG_PAGE_SIZE));
      url.searchParams.set("offset", String(pageParam));
      if (q.length >= 2) url.searchParams.set("q", q);
      const res = await fetch(url.toString(), {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`drug catalog: ${res.status}`);
      const j = (await res.json()) as Response;
      return { rows: j.rows, total: j.total, offset: j.offset ?? pageParam };
    },
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.rows.length, 0);
      // A page can come back shorter than requested when clinic-hidden rows
      // are dropped, so trust the offset walk rather than row counts alone.
      const nextOffset = last.offset + DRUG_PAGE_SIZE;
      return nextOffset < last.total && loaded > 0 ? nextOffset : undefined;
    },
    // Reference data, rarely changes within a session.
    staleTime: 10 * 60_000,
    gcTime: 15 * 60_000,
  });
}
