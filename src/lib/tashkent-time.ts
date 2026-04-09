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
