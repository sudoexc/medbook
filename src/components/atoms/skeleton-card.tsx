import * as React from "react"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

export interface SkeletonCardProps {
  className?: string
  /** Show an avatar-sized circle in the header. */
  withAvatar?: boolean
}

/**
 * Card-sized placeholder for KPI cards, patient cards, doctor cards, etc.
 */
export function SkeletonCard({ className, withAvatar }: SkeletonCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-4",
        className
      )}
    >
      <div className="flex items-center gap-3">
        {withAvatar ? (
          <Skeleton className="size-10 rounded-full" />
        ) : null}
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  )
}
