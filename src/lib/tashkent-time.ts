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

/**
 * Snap any ISO/Date to its 30-min slot key in Tashkent wall clock.
 */
export function tashkentSlotKey(iso: string | Date): string {
  const p = tashkentPartsOf(iso);
  return `${String(p.hours).padStart(2, "0")}:${p.minutes < 30 ? "00" : "30"}`;
}
