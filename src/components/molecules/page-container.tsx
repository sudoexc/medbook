import * as React from "react"

import { cn } from "@/lib/utils"

export interface PageContainerProps {
  children: React.ReactNode
  className?: string
  /** Remove the default max-width for full-bleed dashboards. */
  fullBleed?: boolean
}

/**
 * Standard page padding + max-width for CRM screens. Lives inside the main
 * scroll area of the CRM layout shell.
 */
export function PageContainer({
  children,
  className,
  fullBleed = false,
}: PageContainerProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-5 p-4 sm:p-6",
        !fullBleed && "mx-auto w-full max-w-[1800px]",
        className
      )}
    >
      {children}
    </div>
  )
}
