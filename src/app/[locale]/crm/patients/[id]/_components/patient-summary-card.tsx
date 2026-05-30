"use client";

/**
 * <PatientSummaryCard /> — Phase 15 Wave 2.
 *
 * Shows the AI-generated patient summary on the patient card and inside the
 * appointment drawer. On mount calls `GET /api/crm/patients/[id]/summary`,
 * which returns either a fresh cached value or a stale value plus
 * `pendingRefresh: true`. When pending, the component subscribes to the
 * `patient.summary.refreshed` SSE event and refetches once it fires.
 *
 * Two visual variants:
 *   - `card` (default): full bordered card with header, refresh button,
 *     "AI · Авто" tag, and "обновлено N min ago".
 *   - `compact`: single-line inline rendering for the appointment drawer
 *     and other tight slots.
 *
 * Refresh button is admin/doctor only — gated server-side by the matching
 * role check on `POST /api/crm/patients/[id]/summary/refresh`.
 */

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon, SparklesIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveQueryInvalidation } from "@/hooks/use-live-query";

import { useCurrentRole } from "../_hooks/use-current-role";

export type PatientSummaryCardProps = {
  patientId: string;
  variant?: "card" | "compact";
};

type SummaryResponse = {
  text: string;
  cacheAge: "fresh" | "stale" | "missing";
  pendingRefresh: boolean;
  updatedAt: string | null;
};

function summaryQueryKey(patientId: string, locale: string) {
  return ["patient-summary", patientId, locale] as const;
}

async function fetchSummary(
  patientId: string,
  locale: string,
  signal: AbortSignal,
): Promise<SummaryResponse> {
  const res = await fetch(
    `/api/crm/patients/${patientId}/summary?locale=${locale}`,
    { credentials: "include", signal },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as SummaryResponse;
}

async function postRefresh(
  patientId: string,
  locale: string,
): Promise<SummaryResponse> {
  const res = await fetch(
    `/api/crm/patients/${patientId}/summary/refresh?locale=${locale}`,
    { method: "POST", credentials: "include" },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as SummaryResponse;
}

function formatRelativeAgo(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function PatientSummaryCard({
  patientId,
  variant = "card",
}: PatientSummaryCardProps) {
  const t = useTranslations("patientSummary");
  const locale = useLocale();
  const role = useCurrentRole();
  const qc = useQueryClient();
  const canRefresh =
    role === "ADMIN" || role === "SUPER_ADMIN" || role === "DOCTOR";

  const queryKey = summaryQueryKey(patientId, locale);
  const q = useQuery<SummaryResponse, Error>({
    queryKey,
    queryFn: ({ signal }) => fetchSummary(patientId, locale, signal),
    staleTime: 30_000,
  });

  // Re-fetch when the worker publishes the refreshed event for THIS patient.
  useLiveQueryInvalidation({
    events: ["patient.summary.refreshed"],
    queryKey: queryKey as unknown as readonly unknown[],
    shouldInvalidate: (event) =>
      event.type === "patient.summary.refreshed" &&
      event.payload.patientId === patientId,
    enabled: true,
  });

  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => {
    if (!canRefresh) return;
    setRefreshing(true);
    try {
      const result = await postRefresh(patientId, locale);
      qc.setQueryData<SummaryResponse>(queryKey, result);
    } catch {
      // best-effort — the existing query state stays
    } finally {
      setRefreshing(false);
    }
  }, [canRefresh, patientId, locale, qc, queryKey]);

  const data = q.data;
  const isInitialLoading = q.isLoading;
  const isError = q.isError && !data;
  const text = data?.text ?? "";
  const pending = Boolean(data?.pendingRefresh) || refreshing;
  const empty =
    !isInitialLoading && !isError && !pending && text.trim().length === 0;

  if (variant === "compact") {
    return (
      <div className="flex items-start gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs">
        <SparklesIcon
          className={cn(
            "mt-0.5 size-3.5 shrink-0 text-primary",
            empty && "text-muted-foreground/50",
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1 leading-snug">
          {isInitialLoading ? (
            <Skeleton className="h-3 w-3/4" />
          ) : isError ? (
            <span className="flex items-center gap-1.5 text-destructive">
              {t("error")}
              <button
                type="button"
                onClick={() => void q.refetch()}
                className="underline-offset-2 hover:underline"
              >
                {t("retry")}
              </button>
            </span>
          ) : empty ? (
            <span className="text-muted-foreground">{t("empty")}</span>
          ) : (
            <>
              <span className="text-foreground">{text || t("loading")}</span>
              {pending ? (
                <span className="ml-1 text-muted-foreground">
                  ({t("refreshing")})
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SparklesIcon
            className={cn(
              "size-4 text-primary",
              empty && "text-muted-foreground/50",
            )}
            aria-hidden
          />
          <h3 className="text-sm font-medium text-foreground">{t("title")}</h3>
          <Badge variant="muted" className="gap-1">
            {t("aiTag")}
          </Badge>
          {data?.updatedAt ? (
            <span className="text-xs text-muted-foreground">
              {t("updatedAt", { time: formatRelativeAgo(data.updatedAt) })}
            </span>
          ) : null}
        </div>
        {canRefresh ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={pending}
            aria-label={t("refresh")}
          >
            <RefreshCwIcon
              className={cn("size-3.5", pending && "animate-spin")}
            />
            {t("refresh")}
          </Button>
        ) : null}
      </div>

      {isInitialLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-4/6" />
        </div>
      ) : isError ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-destructive">{t("error")}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void q.refetch()}
          >
            {t("retry")}
          </Button>
        </div>
      ) : empty ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <p className="text-sm leading-relaxed text-foreground">
          {text || t("loading")}
          {pending ? (
            <span className="ml-1 text-xs text-muted-foreground">
              ({t("refreshing")})
            </span>
          ) : null}
        </p>
      )}
    </section>
  );
}
