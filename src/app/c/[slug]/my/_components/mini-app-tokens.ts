/**
 * Mini App design tokens. Keeps the visual language for status colours,
 * elevations, and spacing in one place so screens don't repeat hex values
 * inline (or worse — diverge over time).
 *
 * Status colours are sized for accent strips and soft tints, not text — we
 * paint a 2-3px left border on cards plus a faint background wash. They're
 * deliberately desaturated so they sit alongside the Telegram theme without
 * fighting it.
 *
 * Every value is scheme-aware via CSS `light-dark()` — the shell sets
 * `color-scheme` on the root from Telegram's colorScheme, so labels stay
 * readable on dark backgrounds (the old light-only #b45309-style labels
 * dropped to ~3:1 contrast in dark themes) and tints get a higher mix
 * percentage where 6-8% would vanish against a dark section bg.
 */
export type AppointmentStatusTone = {
  /** Solid accent for the 3px left strip on the card. */
  border: string;
  /** Faint background tint mixed over the section bg. */
  tint: string;
  /** Color for the status pill label. */
  label: string;
};

function tone(
  border: string,
  base: string,
  lightPct: number,
  darkPct: number,
  labelLight: string,
  labelDark: string,
): AppointmentStatusTone {
  return {
    border,
    tint: `light-dark(color-mix(in oklch, ${base} ${lightPct}%, transparent), color-mix(in oklch, ${base} ${darkPct}%, transparent))`,
    label: `light-dark(${labelLight}, ${labelDark})`,
  };
}

export const APPOINTMENT_STATUS_TONES: Record<string, AppointmentStatusTone> = {
  BOOKED: tone("#2353FF", "#2353FF", 8, 16, "#2353FF", "#8FA8FF"),
  CONFIRMED: tone("#10b981", "#10b981", 8, 16, "#059669", "#34d399"),
  WAITING: tone("#f59e0b", "#f59e0b", 10, 18, "#b45309", "#fbbf24"),
  IN_PROGRESS: tone("#0ea5e9", "#0ea5e9", 8, 16, "#0369a1", "#38bdf8"),
  COMPLETED: {
    border: "color-mix(in oklch, var(--tg-hint) 50%, transparent)",
    tint: "transparent",
    label: "var(--tg-hint)",
  },
  CANCELLED: tone("#ef4444", "#ef4444", 6, 14, "#b91c1c", "#f87171"),
  NO_SHOW: tone("#a855f7", "#a855f7", 6, 14, "#7e22ce", "#c084fc"),
  SKIPPED: tone("#94a3b8", "#94a3b8", 8, 14, "#475569", "#cbd5e1"),
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
  NORMAL: tone("#10b981", "#10b981", 8, 16, "#059669", "#34d399"),
  LOW: tone("#0ea5e9", "#0ea5e9", 10, 18, "#0369a1", "#38bdf8"),
  HIGH: tone("#f59e0b", "#f59e0b", 12, 20, "#b45309", "#fbbf24"),
  CRITICAL: tone("#ef4444", "#ef4444", 12, 20, "#b91c1c", "#f87171"),
};

export function getLabFlagTone(flag: string): AppointmentStatusTone {
  return LAB_FLAG_TONES[flag] ?? LAB_FLAG_TONES.NORMAL;
}

/**
 * Solid accent hexes for icon fills, live dots, and color-mix tints — the
 * places that want a scheme-stable base colour rather than a text-safe pair.
 * For text, use the shell vars instead: --ma-success / --ma-danger /
 * --ma-warning / --ma-info (and *-solid / --ma-success-bg for fills).
 */
export const MA_ACCENTS = {
  success: "#10b981",
  warning: "#f59e0b",
  info: "#0ea5e9",
  salmon: "#ff8a65",
  pink: "#FF7BA1",
} as const;
