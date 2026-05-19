import * as React from "react"
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export interface KpiTileProps {
  label: string
  value: React.ReactNode
  /** Optional small muted text rendered immediately after the value. */
  unit?: string
  delta?: { value: string; direction: "up" | "down" | "flat" } | null
  /** Static muted bottom-line text shown when no `delta` is provided. */
  subtitle?: string
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
  unit,
  delta,
  subtitle,
  icon,
  tone = "primary",
  className,
}: KpiTileProps) {
  return (
    <div
      data-kpi-card
      className={cn(
        "flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]",
        className
      )}
    >
      <div className="flex flex-1 items-start gap-3">
        {icon ? (
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg",
              TONE_CHIP[tone]
            )}
          >
            {icon}
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="flex flex-wrap items-baseline gap-x-1.5 leading-tight">
            <span className="text-2xl font-semibold text-foreground">
              {value}
            </span>
            {unit ? (
              <span className="text-sm font-medium text-muted-foreground">
                {unit}
              </span>
            ) : null}
          </div>
          <div className="mt-auto min-h-4 text-xs font-medium leading-4">
            {delta ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1",
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
              </span>
            ) : subtitle ? (
              <span className="text-muted-foreground">{subtitle}</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
