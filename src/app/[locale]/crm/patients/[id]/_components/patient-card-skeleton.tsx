"use client";

import { PageContainer } from "@/components/molecules/page-container";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRow } from "@/components/atoms/skeleton-row";

export function PatientCardSkeleton() {
  return (
    <PageContainer>
      <Skeleton className="h-4 w-32" />
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex gap-4">
          <Skeleton className="size-16 rounded-full" />
          <div className="flex flex-1 flex-col gap-3">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
            <div className="grid grid-cols-3 gap-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          </div>
        </div>
      </div>
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonRow key={i} cols={4} />
        ))}
      </div>
    </PageContainer>
  );
}
