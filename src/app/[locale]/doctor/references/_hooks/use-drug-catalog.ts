"use client";

import { useInfiniteQuery, useQuery, type InfiniteData } from "@tanstack/react-query";

import type { DrugDetail } from "../../_components/drug-detail";

type Response = { rows: DrugDetail[]; total: number; offset: number };

export type DrugCatalogPage = {
  rows: DrugDetail[];
  /** Matches in the database for this query, before paging. */
  total: number;
  offset: number;
};

/** Rows per request — the API's own ceiling. */
export const DRUG_PAGE_SIZE = 100;

export type DrugQuery = {
  term: string;
  /** ATC anatomical letter, e.g. "N". Empty = whole catalog. */
  atc: string | null;
  /** "rx" | "otc" | null */
  rx: "rx" | "otc" | null;
  /** Only drugs with curated dosing text. */
  withDosing: boolean;
  /** Restrict to these ids — the favourites view. */
  ids: string[] | null;
  /** Worklist mode: only drugs still missing a packaging photo. */
  noPhoto: boolean;
};

/**
 * Paged drug lookup for the reference browser.
 *
 * This used to fetch the whole catalog once («~160 rows, limit=200 covers
 * it») and filter in the browser. After the state-register import the
 * catalog holds ~2.7k drugs, so that request silently truncated. Everything
 * — search, ATC group, Rx filter, favourites — now runs server-side, and the
 * list streams in as the doctor scrolls.
 */
export function useDrugCatalog(query: DrugQuery) {
  const q = query.term.trim();
  const enabled = query.ids === null || query.ids.length > 0;
  return useInfiniteQuery<
    DrugCatalogPage,
    Error,
    InfiniteData<DrugCatalogPage>,
    readonly unknown[],
    number
  >({
    queryKey: [
      "doctor",
      "references",
      "drug-catalog",
      q,
      query.atc,
      query.rx,
      query.withDosing,
      query.noPhoto,
      query.ids?.join(",") ?? null,
    ],
    enabled,
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const url = new URL("/api/crm/catalogs/drugs", window.location.origin);
      url.searchParams.set("limit", String(DRUG_PAGE_SIZE));
      url.searchParams.set("offset", String(pageParam));
      if (q.length >= 2) url.searchParams.set("q", q);
      if (query.atc) url.searchParams.set("atc", query.atc);
      if (query.rx) url.searchParams.set("rxOnly", String(query.rx === "rx"));
      if (query.withDosing) url.searchParams.set("withDosing", "true");
      if (query.noPhoto) url.searchParams.set("noPhoto", "true");
      if (query.ids?.length) url.searchParams.set("ids", query.ids.join(","));
      const res = await fetch(url.toString(), {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`drug catalog: ${res.status}`);
      const j = (await res.json()) as Response;
      return { rows: j.rows, total: j.total, offset: j.offset ?? pageParam };
    },
    getNextPageParam: (last) => {
      const nextOffset = last.offset + DRUG_PAGE_SIZE;
      return nextOffset < last.total ? nextOffset : undefined;
    },
    staleTime: 10 * 60_000,
    gcTime: 15 * 60_000,
  });
}

/**
 * One drug's full card by id, through the same endpoint (and so the same
 * clinic overlay and visibility rules) as every list. `null` when the clinic
 * cannot see it: hidden, retired or another clinic's row.
 */
export async function fetchDrugById(
  id: string,
  signal?: AbortSignal,
): Promise<DrugDetail | null> {
  const url = new URL("/api/crm/catalogs/drugs", window.location.origin);
  url.searchParams.set("ids", id);
  url.searchParams.set("limit", "1");
  const res = await fetch(url.toString(), { credentials: "include", signal });
  if (!res.ok) throw new Error(`drug ${id}: ${res.status}`);
  const j = (await res.json()) as Response;
  return j.rows.find((r) => r.id === id) ?? null;
}

export type DrugFacets = {
  total: number;
  byGroup: Record<string, number>;
  withoutAtc: number;
  rxCount: number;
  otcCount: number;
  dosingCount: number;
  photoCount: number;
};

/** Counts for the ATC rail and the filter chips. */
export function useDrugFacets() {
  return useQuery<DrugFacets, Error>({
    queryKey: ["doctor", "references", "drug-facets"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/catalogs/drugs/facets", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`drug facets: ${res.status}`);
      return (await res.json()) as DrugFacets;
    },
    staleTime: 30 * 60_000,
  });
}
