"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRightIcon, ZapIcon } from "lucide-react";

import { useActionsList } from "../../action-center/_hooks/use-actions";
import { ActionCard } from "../../action-center/_components/action-card";

/**
 * Top-of-reception briefing tile that surfaces the five most urgent OPEN
 * actions across the clinic. Hidden entirely when there are zero open
 * actions — we don't want a permanent "all clear" widget cluttering the
 * dashboard.
 *
 * Data is the same `useActionsList` hook used by the Action Center page,
 * so SSE invalidation and tanstack caching are shared. Filter is fixed at
 * `status=OPEN, limit=5`; the API already handles the
 * `severity DESC, createdAt DESC` ordering server-side, so the top 5
 * slot we fetch is guaranteed to be the highest-severity open work.
 */
export function ActionBriefing() {
  const t = useTranslations("reception.briefing");
  const locale = useLocale();

  const query = useActionsList({ status: ["OPEN"], limit: 5 });

  const localePath = React.useCallback(
    (path: string) => {
      if (!path.startsWith("/")) return path;
      return `/${locale}${path}`;
    },
    [locale],
  );

  if (query.isLoading) {
    return (
      <section
        aria-label={t("title")}
        className="rounded-xl border border-border bg-card p-3"
      >
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded-lg border border-border bg-card/40"
            />
          ))}
        </div>
      </section>
    );
  }

  const rows = query.data?.rows ?? [];
  if (rows.length === 0) return null;

  return (
    <section
      aria-label={t("title")}
      className="rounded-xl border border-border bg-card p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          <span className="inline-flex size-5 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ZapIcon className="size-3" />
          </span>
          {t("title")}
          <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
            {rows.length}
          </span>
        </h2>
        <Link
          href={`/${locale}/crm/action-center`}
          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline"
        >
          {t("viewAll")}
          <ChevronRightIcon className="size-3" />
        </Link>
      </div>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <ActionCard
            key={row.id}
            row={row}
            variant="compact"
            localePath={localePath}
          />
        ))}
      </div>
    </section>
  );
}

export default ActionBriefing;
