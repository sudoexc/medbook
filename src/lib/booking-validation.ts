/**
 * Tashkent is UTC+5 year-round (no DST).
 * All appointment times are stored as UTC in DB but reasoned about as
 * "Tashkent wall clock" in the UI and business logic.
 */
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * Construct a UTC-backed Date from Tashkent wall clock components.
 * Example: toTashkentDate("2026-04-09", "09:00") → Date representing 04:00 UTC.
 */
export function toTashkentDate(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00+05:00`);
}

/**
 * Return Tashkent wall clock components for "now".
 */
export function tashkentNow() {
  return tashkentComponents(new Date());
}

/**
 * Return UTC-backed Date bounds for "today" in Tashkent (or any given moment).
 * `dayStart` is midnight Tashkent and `dayEnd` is the next midnight Tashkent.
 *
 * Use this instead of `new Date(); d.setHours(0,0,0,0)` — that pattern picks
 * server-local midnight, which on Vercel is UTC and skews ±5h vs. Tashkent.
 */
export function tashkentDayBounds(at: Date = new Date()) {
  const comp = tashkentComponents(at);
  const dayStart = new Date(`${comp.date}T00:00:00+05:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
}

/**
 * Return [dayStart, dayEnd) for a YYYY-MM-DD string interpreted as Tashkent.
 */
export function tashkentDayBoundsForDateString(dateStr: string) {
  const dayStart = new Date(`${dateStr}T00:00:00+05:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
}

/**
 * Snap a UTC Date to its 30-minute slot key in Tashkent wall clock ("HH:00" / "HH:30").
 * Used to match appointments back to grid slots without server-local skew.
 */
export function tashkentSlotKey(date: Date): string {
  const c = tashkentComponents(date);
  const [hh, mi] = c.time.split(":").map(Number);
  return `${String(hh).padStart(2, "0")}:${mi < 30 ? "00" : "30"}`;
}

/**
 * Convert any Date to Tashkent wall clock components.
 */
export function tashkentComponents(date: Date) {
  const t = new Date(date.getTime() + TASHKENT_OFFSET_MS);
  const yyyy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  const hh = String(t.getUTCHours()).padStart(2, "0");
  const mi = String(t.getUTCMinutes()).padStart(2, "0");
  return {
    date: `${yyyy}-${mm}-${dd}`,
    time: `${hh}:${mi}`,
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
    dow: t.getUTCDay(), // 0 = Sunday
    timestamp: date.getTime(),
  };
}
