/**
 * «Действует сегодня?» for the public sick-leave check (audit CD-03).
 *
 * `periodFrom` / `periodTo` are `@db.Date` columns: calendar days stored as
 * UTC midnight. "Today" has to be the clinic's calendar day, not the
 * server's. The old check built today from `getUTC*`, so between 00:00 and
 * 05:00 in Tashkent it still used yesterday: an employer checking at 02:00
 * a certificate that ended the day before read «ДЕЙСТВУЕТ СЕГОДНЯ».
 *
 * Both sides are compared as `YYYY-MM-DD` keys, which sort as dates.
 */
import { tashkentComponents } from "@/lib/booking-validation";

/** The `YYYY-MM-DD` a `@db.Date` value stands for (read in UTC, as stored). */
export function dateOnlyKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function sickLeaveInEffectOn(
  sl: { status: string; periodFrom: Date; periodTo: Date },
  now: Date = new Date(),
): boolean {
  if (sl.status !== "ISSUED") return false;
  const today = tashkentComponents(now).date;
  return today >= dateOnlyKey(sl.periodFrom) && today <= dateOnlyKey(sl.periodTo);
}
