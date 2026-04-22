import * as React from "react"
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export interface KpiTileProps {
  label: string
  value: React.ReactNode
  delta?: { value: string; direction: "up" | "down" | "flat" } | null
  icon?: React.ReactNode
  /** Accent color for the icon chip. */
  tone?: "primary" | "info" | "warning" | "success" | "violet" | "pink" | "neutral"
  className?: string
}

const TONE_CHIP: Record<NonNullable<KpiTileProps["tone"]>, string> = {
  primary: "bg-primary/15 text-primary",
  info: "bg-info/15 text-[color:var(--info)]",
  warning: "bg-warning/20 text-[color:var(--warning-foreground)]",
  success: "bg-success/15 text-[color:var(--success)]",
  violet: "bg-violet/15 text-[color:var(--violet)]",
  pink: "bg-pink/15 text-[color:var(--pink)]",
  neutral: "bg-muted text-muted-foreground",
}

export function KpiTile({
  label,
  value,
  delta,
  icon,
  tone = "primary",
  className,
}: KpiTileProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="text-2xl font-semibold leading-tight text-foreground">
            {value}
          </div>
        </div>
        {icon ? (
          <div
            className={cn(
              "flex size-9 items-center justify-center rounded-lg",
              TONE_CHIP[tone]
            )}
          >
            {icon}
          </div>
        ) : null}
      </div>
      {delta ? (
        <div
          className={cn(
            "mt-2 inline-flex items-center gap-1 text-xs font-medium",
            delta.direction === "up" && "text-[color:var(--success)]",
            delta.direction === "down" && "text-[color:var(--destructive)]",
            delta.direction === "flat" && "text-muted-foreground"
          )}
        >
          {delta.direction === "up" ? (
            <ArrowUpIcon className="size-3" />
          ) : delta.direction === "down" ? (
            <ArrowDownIcon className="size-3" />
          ) : null}
          {delta.value}
        </div>
      ) : null}
    </div>
  )
}
