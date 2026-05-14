"use client";

import { ChevronDownIcon, Loader2Icon } from "lucide-react";

import { usePatientsFilters } from "../_hooks/patients-context";
import {
  flattenDoctorPatients,
  useMyPatients,
} from "../_hooks/use-my-patients";

export function PatientsPagination() {
  const { filters } = usePatientsFilters();
  const query = useMyPatients(filters);
  const rows = flattenDoctorPatients(query.data);
  const total = query.data?.pages[0]?.total ?? null;
  const loadedCount = rows.length;

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-3">
      <div className="text-xs text-muted-foreground tabular-nums">
        {total !== null ? (
          <>
            Показано {loadedCount} из{" "}
            {total.toLocaleString("ru-RU").replace(",", " ")} пациентов
          </>
        ) : (
          "—"
        )}
      </div>

      <div className="flex items-center gap-2">
        {query.hasNextPage ? (
          <button
            type="button"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            {query.isFetchingNextPage ? (
              <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <ChevronDownIcon className="size-4 text-muted-foreground" />
            )}
            Загрузить ещё
          </button>
        ) : null}
      </div>
    </section>
  );
}
