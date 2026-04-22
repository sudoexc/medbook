"use client"

import * as React from "react"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { TagChip, type TagChipColor } from "@/components/atoms/tag-chip"

export interface FilterChip {
  id: string
  label: string
  color?: TagChipColor
}

export interface FilterBarProps {
  chips: FilterChip[]
  onRemove?: (id: string) => void
  onClear?: () => void
  actions?: React.ReactNode
  className?: string
}

/**
 * A horizontal bar of removable filter chips with "Clear all" affordance and
 * a right-side action slot. Pages own the filter state.
 */
export function FilterBar({
  chips,
  onRemove,
  onClear,
  actions,
  className,
}: FilterBarProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2",
        className
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {chips.length === 0 ? (
          <span className="text-sm text-muted-foreground">Нет фильтров</span>
        ) : (
          chips.map((c) => (
            <TagChip
              key={c.id}
              label={c.label}
              color={c.color ?? "neutral"}
              onRemove={onRemove ? () => onRemove(c.id) : undefined}
            />
          ))
        )}
        {chips.length > 0 && onClear ? (
          <Button variant="ghost" size="xs" onClick={onClear} className="gap-1">
            <XIcon />
            Очистить
          </Button>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}
