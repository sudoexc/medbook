import * as React from "react"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export type TagChipColor =
  | "primary"
  | "info"
  | "warning"
  | "success"
  | "violet"
  | "pink"
  | "yellow"
  | "neutral"

const COLOR_CLASS: Record<TagChipColor, string> = {
  primary: "bg-primary/15 text-primary",
  info: "bg-info/15 text-[color:var(--info)]",
  warning: "bg-warning/20 text-[color:var(--warning-foreground)]",
  success: "bg-success/15 text-[color:var(--success)]",
  violet: "bg-violet/15 text-[color:var(--violet)]",
  pink: "bg-pink/15 text-[color:var(--pink)]",
  yellow: "bg-yellow/30 text-[color:var(--yellow-foreground)]",
  neutral: "bg-muted text-muted-foreground",
}

export interface TagChipProps {
  label: string
  color?: TagChipColor
  onRemove?: () => void
  className?: string
}

export function TagChip({
  label,
  color = "neutral",
  onRemove,
  className,
}: TagChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        COLOR_CLASS[color],
        className
      )}
    >
      {label}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="rounded-full p-0.5 hover:bg-black/10"
          aria-label={`Remove ${label}`}
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </span>
  )
}
