import * as React from "react"

import { cn } from "@/lib/utils"

export interface TwoPaneLayoutProps {
  main: React.ReactNode
  aside: React.ReactNode
  /** Width of the aside in pixels (default 340). */
  asideWidth?: number
  className?: string
}

/**
 * Split layout for pages like Patient card: a scrollable main area and a
 * sticky right aside (quick-actions / related widgets).
 */
export function TwoPaneLayout({
  main,
  aside,
  asideWidth = 340,
  className,
}: TwoPaneLayoutProps) {
  return (
    <div className={cn("flex min-h-0 flex-1", className)}>
      <div className="min-w-0 flex-1 overflow-y-auto">{main}</div>
      <aside
        className="shrink-0 border-l border-border bg-card"
        style={{ width: asideWidth }}
      >
        {aside}
      </aside>
    </div>
  )
}
