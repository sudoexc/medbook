"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, FileTextIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { useReceptionContext } from "../_hooks/reception-context";

type HistoryRow = {
  id: string;
  date: string;
  status: string;
  primaryService: { id: string; nameRu: string | null; nameUz: string | null } | null;
  doctor: { id: string; nameRu: string | null; nameUz: string | null };
};

export function HistoryDocsCard() {
  const { activeAppointment } = useReceptionContext();
  const patientId = activeAppointment?.patient.id ?? null;

  const history = useQuery({
    queryKey: ["doctor", "reception", "history", patientId],
    enabled: !!patientId,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        patientId: patientId!,
        status: "COMPLETED",
        sort: "date",
        dir: "desc",
        limit: "5",
      });
      const res = await fetch(`/api/crm/appointments?${params.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`history ${res.status}`);
      const data = (await res.json()) as { rows: HistoryRow[] };
      return data.rows;
    },
    staleTime: 30_000,
  });

  const tab = "visits" as const;

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-card">
      <div className="flex min-w-0 items-center gap-0.5 border-b border-border px-2 pt-2">
        <button
          type="button"
          className={cn(
            "relative -mb-px inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap px-2 text-sm font-medium",
            tab === "visits" ? "text-foreground" : "text-muted-foreground",
          )}
        >
          История визитов
          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary tabular-nums">
            {history.data?.length ?? 0}
          </span>
          <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
        </button>
      </div>

      {!patientId ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          Выберите пациента, чтобы увидеть историю.
        </p>
      ) : history.isLoading ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          Загружаем…
        </p>
      ) : (history.data ?? []).length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          Завершённых визитов пока нет.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {(history.data ?? []).map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted"
            >
              <span className="inline-flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <FileTextIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {d.primaryService?.nameRu ?? "Консультация"}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {new Date(d.date).toLocaleDateString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}{" "}
                  · {d.doctor.nameRu ?? d.doctor.nameUz ?? "—"}
                </div>
              </div>
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
