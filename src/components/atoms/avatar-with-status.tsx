import * as React from "react"

import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { StatusDot, type StatusDotStatus } from "./status-dot"

const SIZE_CLASS = {
  sm: "size-8",
  md: "size-10",
  lg: "size-12",
  xl: "size-16",
} as const

export interface AvatarWithStatusProps {
  src?: string | null
  name?: string | null
  initials?: string
  status?: StatusDotStatus | null
  size?: keyof typeof SIZE_CLASS
  className?: string
}

function deriveInitials(name?: string | null) {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
}

export function AvatarWithStatus({
  src,
  name,
  initials,
  status,
  size = "md",
  className,
}: AvatarWithStatusProps) {
  const letters = initials ?? deriveInitials(name)

  return (
    <span className={cn("relative inline-flex", className)}>
      <Avatar className={cn(SIZE_CLASS[size])}>
        {src ? <AvatarImage src={src} alt={name ?? ""} /> : null}
        <AvatarFallback>{letters}</AvatarFallback>
      </Avatar>
      {status ? (
        <StatusDot
          status={status}
          size={size === "xl" ? "lg" : size === "sm" ? "xs" : "sm"}
          ring
          className="absolute -bottom-0.5 -right-0.5"
        />
      ) : null}
    </span>
  )
}
