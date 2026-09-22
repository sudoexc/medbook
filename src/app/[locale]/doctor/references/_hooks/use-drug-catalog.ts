"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";

import type { DrugDetail } from "../../_components/drug-detail";

type Response = { rows: DrugDetail[]; total: number };

export type DrugCatalogPage = {
  rows: DrugDetail[];
  /** Rows matching the query in the database, before the page limit. */
  total: number;
};

/** How many rows one request may return — matches the API's own ceiling. */
export const DRUG_PAGE_SIZE = 200;

/**
 * Server-side drug lookup for the reference browser.
 *
 * This used to fetch the whole catalog once («~160 rows, limit=200 covers
 * it») and filter in the browser. After the state-register import the
 * catalog holds ~2.7k drugs, so that request silently truncated: a doctor
 * searching for anything past the cut got «ничего не найдено» while the drug
 * sat in the database. Search now runs on the server — which also ranks by
 * INN / brand / prefix — and the browser only ever holds one page.
 */
export function useDrugCatalog(term: string) {
  const q = term.trim();
  return useQuery<DrugCatalogPage, Error>({
    queryKey: ["doctor", "references", "drug-catalog", q],
    queryFn: async ({ signal }) => {
      const url = new URL("/api/crm/catalogs/drugs", window.location.origin);
      url.searchParams.set("limit", String(DRUG_PAGE_SIZE));
      if (q.length >= 2) url.searchParams.set("q", q);
      const res = await fetch(url.toString(), {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`drug catalog: ${res.status}`);
      const j = (await res.json()) as Response;
      return { rows: j.rows, total: j.total };
    },
    // Keep the previous page on screen while the next query resolves —
    // otherwise every keystroke past the debounce blanks the list.
    placeholderData: keepPreviousData,
    // Reference data, rarely changes within a session.
    staleTime: 10 * 60_000,
    gcTime: 15 * 60_000,
  });
}
