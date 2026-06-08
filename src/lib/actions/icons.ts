/**
 * Icon map per ActionType. Centralised so the page, briefing, and any future
 * surface (notifications, search-result) all show the same glyph for the same
 * detector.
 *
 * Pure module — no React imports beyond the LucideIcon type — so it can be
 * referenced from unit tests without a JSX runtime.
 */
import {
  AlertTriangleIcon,
  BanknoteIcon,
  CalendarClockIcon,
  CalendarXIcon,
  ClockIcon,
  DoorOpenIcon,
  FrownIcon,
  HistoryIcon,
  PhoneOffIcon,
  RotateCwIcon,
  UsersIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";

import type { ActionType } from "@/lib/actions/types";

export const ACTION_ICONS: Record<ActionType, LucideIcon> = {
  EMPTY_SLOT_TOMORROW: CalendarClockIcon,
  DORMANT_BATCH: UsersRoundIcon,
  UNCONFIRMED_24H: ClockIcon,
  NO_SHOW_RISK_HIGH: AlertTriangleIcon,
  CASE_REPEAT_DUE: RotateCwIcon,
  OVERDUE_FOLLOW_UP: HistoryIcon,
  DOCTOR_OVERLOAD: UsersIcon,
  IDLE_ROOM: DoorOpenIcon,
  PAYMENT_OVERDUE: BanknoteIcon,
  LOW_DOCTOR_SCHEDULE: CalendarXIcon,
  LOW_NPS_RECEIVED: FrownIcon,
  PATIENT_NO_CHANNEL: PhoneOffIcon,
};

/** Tailwind colour-token classes for severity dots, borders, and badge tones. */
export const SEVERITY_DOT_CLASS: Record<
  "low" | "medium" | "high" | "critical",
  string
> = {
  critical: "bg-destructive",
  high: "bg-warning",
  medium: "bg-info",
  low: "bg-muted-foreground/40",
};

export const SEVERITY_BORDER_CLASS: Record<
  "low" | "medium" | "high" | "critical",
  string
> = {
  critical: "border-l-destructive",
  high: "border-l-warning",
  medium: "border-l-info",
  low: "border-l-muted",
};

export const SEVERITY_BADGE_VARIANT: Record<
  "low" | "medium" | "high" | "critical",
  "destructive" | "warning" | "info" | "muted"
> = {
  critical: "destructive",
  high: "warning",
  medium: "info",
  low: "muted",
};
