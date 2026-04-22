"use client"

/**
 * Minimal calendar grid — a placeholder for a later date-picker integration.
 * Real date-picker (react-day-picker) will replace this in Phase 2b.
 *
 * For now: shows month of `month` prop, highlights `selected`, fires
 * `onSelect` when a day is clicked. Sufficient for design-system visibility.
 */
import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export interface CalendarProps {
  month?: Date
  onMonthChange?: (date: Date) => void
  selected?: Date | null
  onSelect?: (date: Date) => void
  className?: string
  locale?: string
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function Calendar({
  month: monthProp,
  onMonthChange,
  selected,
  onSelect,
  className,
  locale = "ru-RU",
}: CalendarProps) {
  const [internalMonth, setInternalMonth] = React.useState<Date>(
    monthProp ?? startOfMonth(new Date())
  )
  const month = monthProp ?? internalMonth

  const setMonth = (next: Date) => {
    if (onMonthChange) onMonthChange(next)
    else setInternalMonth(next)
  }

  const first = startOfMonth(month)
  // Week starts Mon (ISO). firstCol = Mon=0..Sun=6
  const firstCol = (first.getDay() + 6) % 7
  const daysInMonth = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0
  ).getDate()

  const cells: (Date | null)[] = []
  for (let i = 0; i < firstCol; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(month.getFullYear(), month.getMonth(), d))
  }
  while (cells.length % 7 !== 0) cells.push(null)

  const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
  const title = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(month)

  const isSameDay = (a: Date, b: Date | null | undefined) =>
    !!b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  return (
    <div className={cn("w-[280px] rounded-lg border border-border bg-card p-3", className)}>
      <div className="flex items-center justify-between pb-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
          }
          aria-label="Previous month"
        >
          <ChevronLeftIcon />
        </Button>
        <div className="text-sm font-medium capitalize">{title}</div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
          }
          aria-label="Next month"
        >
          <ChevronRightIcon />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {weekdays.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />
          const active = isSameDay(d, selected ?? undefined)
          const today = isSameDay(d, new Date())
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect?.(d)}
              className={cn(
                "h-8 w-8 rounded-md text-xs transition-colors",
                "hover:bg-muted",
                today && !active && "text-primary font-semibold",
                active && "bg-primary text-primary-foreground"
              )}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export { Calendar }
