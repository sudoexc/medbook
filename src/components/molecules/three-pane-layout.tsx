import * as React from "react"

import { cn } from "@/lib/utils"

export interface ThreePaneLayoutProps {
  left: React.ReactNode
  middle: React.ReactNode
  right: React.ReactNode
  /** px widths of left and right rails (middle is flex-1). */
  leftWidth?: number
  rightWidth?: number
  className?: string
}

/**
 * Three-pane layout used by Call Center and Telegram inbox:
 *   left = list of conversations / queue
 *   middle = active conversation / detail
 *   right = contextual panel (patient card, actions)
 */
export function ThreePaneLayout({
  left,
  middle,
  right,
  leftWidth = 320,
  rightWidth = 340,
  className,
}: ThreePaneLayoutProps) {
  return (
    <div className={cn("flex min-h-0 flex-1", className)}>
      <aside
        className="shrink-0 border-r border-border bg-card"
        style={{ width: leftWidth }}
      >
        {left}
      </aside>
      <div className="min-w-0 flex-1">{middle}</div>
      <aside
        className="shrink-0 border-l border-border bg-card"
        style={{ width: rightWidth }}
      >
        {right}
      </aside>
    </div>
  )
}
