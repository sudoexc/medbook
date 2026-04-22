import * as React from "react"

import { cn } from "@/lib/utils"
import type { PatientSegment } from "./badge-status"

const SEGMENT_CONFIG: Record<PatientSegment, { className: string; label: string }> = {
  VIP: {
    className: "bg-violet/15 text-[color:var(--violet)]",
    label: "VIP",
  },
  REGULAR: {
    className: "bg-info/15 text-[color:var(--info)]",
    label: "Постоянный",
  },
  NEW: {
    className: "bg-primary/15 text-primary",
    label: "Новый",
  },
  INACTIVE: {
    className: "bg-muted text-muted-foreground",
    label: "Неактивный",
  },
}

export interface SegmentPillProps {
  segment: PatientSegment
  label?: string
  className?: string
}

export function SegmentPill({ segment, label, className }: SegmentPillProps) {
  const cfg = SEGMENT_CONFIG[segment]
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
        cfg.className,
        className
      )}
    >
      {label ?? cfg.label}
    </span>
  )
}
