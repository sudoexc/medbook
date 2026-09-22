"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

export type Icd10Hit = {
  code: string;
  nameRu: string;
  /** Clinic-learned entry (signed by a doctor here), not the static list. */
  custom?: boolean;
};

export function useIcd10Search(rawQuery: string) {
  const [debounced, setDebounced] = React.useState(rawQuery);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(rawQuery), 180);
    return () => clearTimeout(t);
  }, [rawQuery]);

  return useQuery<Icd10Hit[]>({
    queryKey: ["icd10", "search", debounced],
    queryFn: async ({ signal }) => {
      // 12 was too tight once real queries were measured: «невропатия»
      // has 30 matching rubrics, «остеохондроз» 17 — the right one could
      // sit just past the cut with nothing on screen saying so.
      const params = new URLSearchParams({ q: debounced, limit: "25" });
      const res = await fetch(`/api/crm/icd10/search?${params.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`icd10 ${res.status}`);
      const data = (await res.json()) as { rows: Icd10Hit[] };
      return data.rows;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
