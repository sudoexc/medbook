import * as React from "react"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

export interface SkeletonRowProps {
  cols?: number
  className?: string
}

/**
 * Single horizontal skeleton row — meant for table placeholders.
 */
export function SkeletonRow({ cols = 4, className }: SkeletonRowProps) {
  return (
    <div className={cn("flex items-center gap-4 py-2", className)}>
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-4 flex-1", i === 0 && "max-w-[12rem]")}
        />
      ))}
    </div>
  )
}
