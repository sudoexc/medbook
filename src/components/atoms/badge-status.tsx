import * as React from "react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

/**
 * AppointmentStatus and similar short-enum badges (TZ §4.1).
 *
 * The label map is deliberately minimal and Russian; pages may pass an
 * explicit `label` when they need a translated string via next-intl.
 */
export type AppointmentStatus =
  | "NEW"
  | "WAITING"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "NO_SHOW"
  | "CANCELLED"
  | "RESCHEDULED"

export type PaymentStatus = "PAID" | "PENDING" | "REFUNDED" | "FAILED"

export type PatientSegment = "VIP" | "REGULAR" | "NEW" | "INACTIVE"

export type BadgeStatusKind = AppointmentStatus | PaymentStatus | PatientSegment

const STATUS_CONFIG: Record<BadgeStatusKind, { variant: React.ComponentProps<typeof Badge>["variant"]; label: string }> = {
  NEW: { variant: "violet", label: "Новый" },
  WAITING: { variant: "warning", label: "Ожидает" },
  CONFIRMED: { variant: "info", label: "Подтверждён" },
  IN_PROGRESS: { variant: "default", label: "На приёме" },
  COMPLETED: { variant: "success", label: "Завершён" },
  NO_SHOW: { variant: "muted", label: "Не пришёл" },
  CANCELLED: { variant: "destructive", label: "Отменён" },
  RESCHEDULED: { variant: "yellow", label: "Перенесён" },
  PAID: { variant: "success", label: "Оплачен" },
  PENDING: { variant: "warning", label: "Ожидает оплаты" },
  REFUNDED: { variant: "muted", label: "Возврат" },
  FAILED: { variant: "destructive", label: "Ошибка" },
  VIP: { variant: "violet", label: "VIP" },
  REGULAR: { variant: "info", label: "Постоянный" },
  INACTIVE: { variant: "muted", label: "Неактивный" },
}

export interface BadgeStatusProps {
  status: BadgeStatusKind
  label?: string
  className?: string
}

export function BadgeStatus({ status, label, className }: BadgeStatusProps) {
  const cfg = STATUS_CONFIG[status]
  return (
    <Badge variant={cfg.variant} className={cn(className)}>
      {label ?? cfg.label}
    </Badge>
  )
}
