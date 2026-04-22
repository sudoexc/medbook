"use client"

import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export interface CopyButtonProps {
  value: string
  className?: string
  size?: "xs" | "sm" | "default"
  label?: string
  /** ms before the check icon reverts back to copy. */
  successDuration?: number
}

/**
 * Copy-to-clipboard button with a 2-second success feedback.
 * Falls back gracefully when the clipboard API is unavailable (e.g. iframes).
 */
export function CopyButton({
  value,
  className,
  size = "sm",
  label,
  successDuration = 1800,
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), successDuration)
    } catch {
      // noop — no clipboard permissions; UI stays as-is.
    }
  }

  return (
    <Button
      variant="ghost"
      size={label ? size : "icon-sm"}
      onClick={onCopy}
      aria-label={label ?? "Copy"}
      className={cn(className)}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {label}
    </Button>
  )
}
