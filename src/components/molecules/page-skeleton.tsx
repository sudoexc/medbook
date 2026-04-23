import * as React from "react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRow } from "@/components/atoms/skeleton-row";
import { PageContainer } from "@/components/molecules/page-container";

/**
 * Generic CRM page skeleton used by Next.js `loading.tsx` files to provide
 * an instant placeholder during route transitions (§9.6: "при first load
 * страниц — skeleton-плейсхолдеры вместо спиннеров").
 *
 * Layout:
 *   - Section header row (title + action button stubs).
 *   - Optional KPI strip (6 tiles, used by reception / appointments).
 *   - Optional filter row.
 *   - Main body — configurable between "table" and "grid" layouts.
 *   - Optional right rail placeholder.
 *
 * Keep this atom-level simple: if a page needs a more tailored shape, it
 * can still inline its own JSX in `loading.tsx`.
 */
export interface PageSkeletonProps {
  /** Render the 6-tile KPI strip on top of the body. */
  kpi?: boolean;
  /** Render a filter bar placeholder. */
  filters?: boolean;
  /** Body style: list/table rows or card grid. */
  body?: "table" | "grid" | "none";
  /** Number of placeholder body items. */
  rows?: number;
  /** Show a right-rail column on >=xl screens. */
  rail?: boolean;
  className?: string;
}

export function PageSkeleton({
  kpi = false,
  filters = false,
  body = "table",
  rows = 8,
  rail = false,
  className,
}: PageSkeletonProps) {
  return (
    <div className={cn("flex min-h-0 flex-1", className)}>
      <div className="flex min-w-0 flex-1 flex-col">
        <PageContainer className="flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-28" />
            </div>
          </div>

          {kpi ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : null}

          {filters ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-7 w-36" />
              <div className="ml-auto">
                <Skeleton className="h-7 w-20" />
              </div>
            </div>
          ) : null}

          {body === "table" ? (
            <div className="flex min-h-[50vh] flex-1 flex-col rounded-lg border border-border bg-card p-3">
              {Array.from({ length: rows }).map((_, i) => (
                <SkeletonRow key={i} cols={5} />
              ))}
            </div>
          ) : null}

          {body === "grid" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: rows }).map((_, i) => (
                <Skeleton key={i} className="h-40 rounded-xl" />
              ))}
            </div>
          ) : null}
        </PageContainer>
      </div>

      {rail ? (
        <aside className="hidden w-[340px] shrink-0 flex-col gap-3 border-l border-border bg-card p-3 xl:flex">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </aside>
      ) : null}
    </div>
  );
}
