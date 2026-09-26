/**
 * Client-safe Tashkent (UTC+5, no DST) time helpers.
 * Mirrors server-side logic in booking-validation.ts.
 */
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

export function tashkentNowParts() {
  const t = new Date(Date.now() + TASHKENT_OFFSET_MS);
  const yyyy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return {
    date: `${yyyy}-${mm}-${dd}`,
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
  };
}

export function tashkentToday(): string {
  return tashkentNowParts().date;
}

/**
 * Given a YYYY-MM-DD date and HH:mm slot, returns true if the slot is
 * in the past (Tashkent wall clock).
 */
export function isSlotPast(dateStr: string, timeStr: string): boolean {
  const now = tashkentNowParts();
  if (dateStr < now.date) return true;
  if (dateStr > now.date) return false;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m <= now.minutes;
}

/**
 * Convert any ISO string / Date to Tashkent wall clock parts.
 * Use this instead of `new Date(iso).getHours()` — the latter uses server-local
 * time and skews ±5h between dev/Vercel.
 */
export function tashkentPartsOf(iso: string | Date) {
  const t = new Date(new Date(iso).getTime() + TASHKENT_OFFSET_MS);
  const yyyy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return {
    date: `${yyyy}-${mm}-${dd}`,
    hours: t.getUTCHours(),
    minutes: t.getUTCMinutes(),
  };
}

/** The Tashkent calendar day (YYYY-MM-DD) an instant falls on. */
export function tashkentDateOf(at: string | Date | number): string {
  return tashkentPartsOf(new Date(at)).date;
}

/**
 * Calendar arithmetic on a Tashkent YYYY-MM-DD day. Tashkent has no DST, so
 * stepping whole days from local noon can never land on the wrong date.
 */
export function addTashkentDays(dateStr: string, days: number): string {
  const noon = Date.parse(`${dateStr}T12:00:00+05:00`);
  return tashkentDateOf(noon + days * 24 * 60 * 60 * 1000);
}

/**
 * The instants bounding one Tashkent day: `from` is its midnight and `to` its
 * last millisecond. The appointments list filters `to` with `lte`, so handing
 * it the next midnight would pull in a 00:00 slot of the following day.
 */
export function tashkentDayWindow(dateStr: string): { from: Date; to: Date } {
  const from = new Date(`${dateStr}T00:00:00+05:00`);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000 - 1) };
}

/**
 * Snap any ISO/Date to its 30-min slot key in Tashkent wall clock.
 */
export function tashkentSlotKey(iso: string | Date): string {
  const p = tashkentPartsOf(iso);
  return `${String(p.hours).padStart(2, "0")}:${p.minutes < 30 ? "00" : "30"}`;
}
