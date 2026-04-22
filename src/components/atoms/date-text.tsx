"use client"

import * as React from "react"
import { useLocale } from "next-intl"

import { cn } from "@/lib/utils"
import { formatDate, type DateStyle, type Locale } from "@/lib/format"

export interface DateTextProps {
  date: Date | string | number | null | undefined
  style?: DateStyle
  locale?: Locale
  className?: string
}

/**
 * Locale-aware date text. Delegates to `formatDate` in `src/lib/format.ts`.
 */
export function DateText({ date, style = "short", locale, className }: DateTextProps) {
  const activeLocale = (locale ?? (useLocale() as Locale)) ?? "ru"
  const text = formatDate(date, activeLocale, style)
  if (!text) return null
  return <time className={cn(className)}>{text}</time>
}
