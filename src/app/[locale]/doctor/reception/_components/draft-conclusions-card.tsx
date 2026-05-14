"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronRightIcon, FileTextIcon } from "lucide-react";

type DraftRow = {
  id: string;
  status: "DRAFT" | "FINALIZED";
  updatedAt: string;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  patient: { id: string; fullName: string };
  appointment: { id: string; date: string; status: string };
};

export function DraftConclusionsCard() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "ru";

  const q = useQuery({
    queryKey: ["doctor", "reception", "drafts"],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/visit-notes?status=DRAFT&limit=5`,
        { credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`drafts ${res.status}`);
      const data = (await res.json()) as { rows: DraftRow[] };
      return data.rows;
    },
    staleTime: 15_000,
  });

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-card">
      <header className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="truncate text-sm font-semibold text-foreground">Черновики</h3>
      </header>

      {q.isLoading ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          Загружаем…
        </p>
      ) : (q.data ?? []).length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          Черновиков нет.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {(q.data ?? []).map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted"
            >
              <span className="inline-flex size-8 items-center justify-center rounded-lg bg-warning/10 text-warning">
                <FileTextIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {d.patient.fullName}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {d.diagnosisCode
                    ? `${d.diagnosisCode} · ${d.diagnosisName ?? ""}`
                    : "Без диагноза"}{" "}
                  · {new Date(d.updatedAt).toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-border px-4 py-2.5">
        <Link
          href={`/${locale}/doctor/conclusions`}
          className="text-xs font-medium text-primary hover:underline"
        >
          Открыть все заключения
        </Link>
      </div>
    </section>
  );
}
