import * as React from "react"

import { cn } from "@/lib/utils"
import { formatPhone } from "@/lib/format"

export interface PhoneTextProps {
  phone: string | null | undefined
  className?: string
  /** When true, renders a non-link span (e.g. inside another link). */
  asText?: boolean
}

/**
 * Formats a phone number and renders it as a tel: anchor by default.
 */
export function PhoneText({ phone, className, asText = false }: PhoneTextProps) {
  if (!phone) return null
  const formatted = formatPhone(phone)
  if (!formatted) return null
  const href = "tel:" + formatted.replace(/[^\d+]/g, "")

  if (asText) return <span className={cn(className)}>{formatted}</span>
  return (
    <a href={href} className={cn("hover:underline", className)}>
      {formatted}
    </a>
  )
}
