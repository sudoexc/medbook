/**
 * Mini App design tokens. Keeps the visual language for status colours,
 * elevations, and spacing in one place so screens don't repeat hex values
 * inline (or worse — diverge over time).
 *
 * Status colours are sized for accent strips and soft tints, not text — we
 * paint a 2-3px left border on cards plus a faint background wash. They're
 * deliberately desaturated so they sit alongside the Telegram theme without
 * fighting it.
 */
export type AppointmentStatusTone = {
  /** Solid accent for the 3px left strip on the card. */
  border: string;
  /** Faint background tint mixed over the section bg. */
  tint: string;
  /** Color for the status pill label. */
  label: string;
};

export const APPOINTMENT_STATUS_TONES: Record<string, AppointmentStatusTone> = {
  BOOKED: {
    border: "#2353FF",
    tint: "color-mix(in oklch, #2353FF 8%, transparent)",
    label: "#2353FF",
  },
  CONFIRMED: {
    border: "#10b981",
    tint: "color-mix(in oklch, #10b981 8%, transparent)",
    label: "#059669",
  },
  WAITING: {
    border: "#f59e0b",
    tint: "color-mix(in oklch, #f59e0b 10%, transparent)",
    label: "#b45309",
  },
  IN_PROGRESS: {
    border: "#0ea5e9",
    tint: "color-mix(in oklch, #0ea5e9 8%, transparent)",
    label: "#0369a1",
  },
  COMPLETED: {
    border: "color-mix(in oklch, var(--tg-hint) 50%, transparent)",
    tint: "transparent",
    label: "var(--tg-hint)",
  },
  CANCELLED: {
    border: "#ef4444",
    tint: "color-mix(in oklch, #ef4444 6%, transparent)",
    label: "#b91c1c",
  },
  NO_SHOW: {
    border: "#a855f7",
    tint: "color-mix(in oklch, #a855f7 6%, transparent)",
    label: "#7e22ce",
  },
  SKIPPED: {
    border: "#94a3b8",
    tint: "color-mix(in oklch, #94a3b8 8%, transparent)",
    label: "#475569",
  },
};

export function getAppointmentTone(status: string): AppointmentStatusTone {
  return APPOINTMENT_STATUS_TONES[status] ?? APPOINTMENT_STATUS_TONES.BOOKED;
}

/**
 * Lab-result flag tones — a coloured pill + tinted value next to each result
 * so the patient reads "out of range" at a glance, without a number-literate
 * eye. Cool = below range, warm = above, red = critical; we reuse the same
 * hex constants as the appointment palette to keep the Mini App to one set of
 * accent colours. The patient only ever sees REVIEWED rows, so a scary flag
 * has already passed the doctor's eye.
 */
export const LAB_FLAG_TONES: Record<string, AppointmentStatusTone> = {
  NORMAL: {
    border: "#10b981",
    tint: "color-mix(in oklch, #10b981 8%, transparent)",
    label: "#059669",
  },
  LOW: {
    border: "#0ea5e9",
    tint: "color-mix(in oklch, #0ea5e9 10%, transparent)",
    label: "#0369a1",
  },
  HIGH: {
    border: "#f59e0b",
    tint: "color-mix(in oklch, #f59e0b 12%, transparent)",
    label: "#b45309",
  },
  CRITICAL: {
    border: "#ef4444",
    tint: "color-mix(in oklch, #ef4444 12%, transparent)",
    label: "#b91c1c",
  },
};

export function getLabFlagTone(flag: string): AppointmentStatusTone {
  return LAB_FLAG_TONES[flag] ?? LAB_FLAG_TONES.NORMAL;
}
