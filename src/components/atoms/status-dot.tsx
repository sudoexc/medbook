import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Colored presence/status dot.
 *
 * `online/busy/offline` — user presence (sidebar, avatars).
 * `waiting/in-progress/completed/cancelled/no-show/confirmed/new` —
 *    appointment statuses (per TZ §4.1).
 */
export type StatusDotStatus =
  | "online"
  | "busy"
  | "offline"
  | "waiting"
  | "in-progress"
  | "completed"
  | "cancelled"
  | "confirmed"
  | "new"
  | "no-show"
  | "rescheduled"

const STATUS_CLASS: Record<StatusDotStatus, string> = {
  online: "bg-[color:var(--success)]",
  busy: "bg-[color:var(--destructive)]",
  offline: "bg-muted-foreground/50",
  waiting: "bg-[color:var(--warning)]",
  "in-progress": "bg-primary",
  completed: "bg-[color:var(--success)]",
  cancelled: "bg-[color:var(--destructive)]",
  confirmed: "bg-[color:var(--info)]",
  new: "bg-[color:var(--violet)]",
  "no-show": "bg-muted-foreground/60",
  rescheduled: "bg-[color:var(--yellow)]",
}

const SIZE_CLASS = {
  xs: "size-1.5",
  sm: "size-2",
  md: "size-2.5",
  lg: "size-3",
} as const

export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: StatusDotStatus
  size?: keyof typeof SIZE_CLASS
  ring?: boolean
}

export function StatusDot({
  status,
  size = "sm",
  ring = false,
  className,
  ...props
}: StatusDotProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block rounded-full shrink-0",
        SIZE_CLASS[size],
        STATUS_CLASS[status],
        ring && "ring-2 ring-background",
        className
      )}
      {...props}
    />
  )
}
