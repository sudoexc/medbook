"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  ChevronUpIcon,
  Loader2Icon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react";

type SummaryResponse = {
  text: string | null;
  cacheAge: number | null;
  pendingRefresh: boolean;
  updatedAt: string | null;
};

/**
 * Right-rail AI summary on the patient visits-history page.
 *
 * Data sources:
 *  - `GET /api/crm/patients/{id}/summary?locale=ru` — cached LLM summary,
 *    refreshed asynchronously by the worker (`patient.summary.refreshed`
 *    SSE event triggers refetch downstream). Text is one paragraph block;
 *    we split on `\n\n` to render visually if the LLM segmented it.
 *  - `chronicConditions` (from the server component) — rendered as
 *    "Ключевые тенденции". Cheap, deterministic, no extra round-trip.
 *
 * Empty state requirement: when no patient is selected or the cache is
 * empty + a refresh is pending, show a soft skeleton + "AI ещё анализирует
 * визит" so the doctor knows the panel isn't stuck.
 */
export function AISummaryPanel({
  patientId,
  chronicConditions = [],
}: {
  patientId: string | null;
  chronicConditions?: string[];
}) {
  const summary = useQuery<SummaryResponse>({
    queryKey: ["doctor", "patient-summary", patientId],
    enabled: !!patientId,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/patients/${patientId}/summary?locale=ru`,
        { credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`summary ${res.status}`);
      return (await res.json()) as SummaryResponse;
    },
  });

  const paragraphs = React.useMemo(() => {
    const t = summary.data?.text?.trim();
    if (!t) return [];
    return t
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }, [summary.data?.text]);

  return (
    <section className="rounded-2xl border border-border bg-card">
      <header className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-violet text-white">
            <SparklesIcon className="size-3.5" />
          </span>
          <span className="text-[15px] font-semibold text-foreground">
            AI-помощник
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Обновить"
            onClick={() => summary.refetch()}
            disabled={!patientId || summary.isFetching}
            className="motion-press flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {summary.isFetching ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            aria-label="Свернуть"
            className="motion-press flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronUpIcon className="size-3.5" />
          </button>
        </div>
      </header>

      <div className="space-y-4 px-5 pb-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            AI-сводка истории пациента
          </div>
          <div className="mt-1.5 space-y-2 text-xs leading-relaxed text-foreground">
            {!patientId ? (
              <EmptyHint label="Выберите пациента, чтобы открыть сводку." />
            ) : summary.isLoading ? (
              <SummarySkeleton />
            ) : paragraphs.length === 0 ? (
              <EmptyHint
                label={
                  summary.data?.pendingRefresh
                    ? "AI ещё анализирует визит"
                    : "AI ещё анализирует визит"
                }
              />
            ) : (
              paragraphs.map((p, i) => <p key={i}>{p}</p>)
            )}
          </div>
        </div>

        {chronicConditions.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Ключевые тенденции
            </div>
            <ul className="space-y-1.5">
              {chronicConditions.map((label, i) => (
                <li key={`${label}-${i}`} className="flex items-center gap-2 text-xs">
                  <CheckCircle2Icon className="size-4 shrink-0 text-success" />
                  <span className="text-foreground">{label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function SummarySkeleton() {
  return (
    <div className="space-y-1.5">
      <div className="h-3 w-full animate-pulse rounded bg-muted" />
      <div className="h-3 w-[92%] animate-pulse rounded bg-muted" />
      <div className="h-3 w-[78%] animate-pulse rounded bg-muted" />
    </div>
  );
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-background/60 px-3 py-2 text-muted-foreground">
      <Loader2Icon className="size-3.5 animate-spin" />
      <span>{label}</span>
    </div>
  );
}
