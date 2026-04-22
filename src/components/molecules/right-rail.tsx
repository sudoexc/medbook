"use client"

import * as React from "react"
import { ChevronsRightIcon, ChevronsLeftIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { IconButton } from "@/components/atoms/icon-button"

export interface RightRailProps {
  children: React.ReactNode
  title?: React.ReactNode
  className?: string
  /** localStorage key for the collapsed state. */
  storageKey?: string
  defaultCollapsed?: boolean
}

/**
 * Collapsible right rail. Remembers collapsed state in localStorage per
 * `storageKey`. When collapsed, shows a narrow 40px strip with an expand
 * affordance.
 */
export function RightRail({
  children,
  title,
  className,
  storageKey = "crm:right-rail:collapsed",
  defaultCollapsed = false,
}: RightRailProps) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed)

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const raw = window.localStorage.getItem(storageKey)
    if (raw === "1") setCollapsed(true)
    if (raw === "0") setCollapsed(false)
  }, [storageKey])

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c
      if (typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, next ? "1" : "0")
      }
      return next
    })
  }

  if (collapsed) {
    return (
      <aside
        className={cn(
          "flex w-10 shrink-0 flex-col items-center border-l border-border bg-card py-3",
          className
        )}
      >
        <IconButton
          aria-label="Expand right rail"
          variant="ghost"
          size="sm"
          onClick={toggle}
        >
          <ChevronsLeftIcon />
        </IconButton>
      </aside>
    )
  }

  return (
    <aside
      className={cn(
        "flex w-[340px] shrink-0 flex-col border-l border-border bg-card",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="text-sm font-semibold text-foreground">{title ?? "Быстрые действия"}</div>
        <IconButton
          aria-label="Collapse right rail"
          variant="ghost"
          size="sm"
          onClick={toggle}
        >
          <ChevronsRightIcon />
        </IconButton>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
    </aside>
  )
}
