import type { CalendarView } from "../_hooks/use-calendar-filters";

export const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  BOOKED: {
    bg: "var(--color-info-soft, #dbeafe)",
    text: "var(--color-info-foreground, #1e3a8a)",
    border: "var(--color-info, #3b82f6)",
  },
  WAITING: {
    bg: "var(--color-warning-soft, #fef3c7)",
    text: "var(--color-warning-foreground, #78350f)",
    border: "var(--color-warning, #f59e0b)",
  },
  IN_PROGRESS: {
    bg: "var(--color-primary-soft, #ccfbf1)",
    text: "var(--color-primary-foreground, #134e4a)",
    border: "var(--color-primary, #3DD5C0)",
  },
  COMPLETED: {
    bg: "var(--color-success-soft, #d1fae5)",
    text: "var(--color-success-foreground, #064e3b)",
    border: "var(--color-success, #10b981)",
  },
  SKIPPED: {
    bg: "var(--color-muted, #f3f4f6)",
    text: "var(--color-muted-foreground, #4b5563)",
    border: "var(--color-border, #d1d5db)",
  },
  CANCELLED: {
    bg: "var(--color-destructive-soft, #fee2e2)",
    text: "var(--color-destructive-foreground, #7f1d1d)",
    border: "var(--color-destructive, #ef4444)",
  },
  NO_SHOW: {
    bg: "var(--color-muted, #f3f4f6)",
    text: "var(--color-muted-foreground, #4b5563)",
    border: "var(--color-border, #d1d5db)",
  },
};

/** Map calendar view enum to the matching FullCalendar view key. */
export function fcViewKey(view: CalendarView): string {
  switch (view) {
    case "day":
      return "resourceTimeGridDay";
    case "workWeek":
      return "resourceTimeGridWorkWeek";
    case "week":
      return "resourceTimeGridWeek";
  }
}

/**
 * Returns {from, to} range (inclusive start, exclusive end) for the given
 * anchor date + view — used to query the appointments endpoint.
 */
export function rangeForView(anchor: Date, view: CalendarView): { from: Date; to: Date } {
  const d = new Date(anchor);
  d.setHours(0, 0, 0, 0);
  if (view === "day") {
    const end = new Date(d);
    end.setDate(end.getDate() + 1);
    return { from: d, to: end };
  }
  if (view === "workWeek") {
    // Start on Monday, 5 days.
    const day = d.getDay(); // 0 Sun..6 Sat
    const diffToMon = (day + 6) % 7;
    const start = new Date(d);
    start.setDate(start.getDate() - diffToMon);
    const end = new Date(start);
    end.setDate(end.getDate() + 5);
    return { from: start, to: end };
  }
  // week — 7 days Mon..Sun
  const day = d.getDay();
  const diffToMon = (day + 6) % 7;
  const start = new Date(d);
  start.setDate(start.getDate() - diffToMon);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { from: start, to: end };
}

/**
 * Compose a Date from `date` (yyyy-mm-dd from DB) + `time` ("HH:mm" or null).
 * Falls back to the date's midnight if time is missing.
 */
export function composeStart(dateIso: string, time: string | null): Date {
  const base = new Date(dateIso);
  if (!time) return base;
  const [h, m] = time.split(":").map((x) => parseInt(x, 10));
  const d = new Date(base);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}

/** Deterministic HSL colour from an arbitrary id (used for cabinets). */
export function colorFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue}, 68%, 54%)`;
}

export function hhmm(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
