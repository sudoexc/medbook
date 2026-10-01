/**
 * The refund dialog asks for the day the money was given back (audit AN-11)
 * as a Tashkent calendar date. Today means "now": the server stamps the
 * moment it records it. An earlier day becomes 23:59 of that day, which is
 * never before a payment taken that same day and never in the future.
 */
import { tashkentDateOf, tashkentDayWindow } from "@/lib/tashkent-time";

export type RefundDateCheck =
  | { ok: true; refundedAt: Date | null }
  | { ok: false };

export function refundInstantFor(
  dateStr: string,
  today: string,
  paidAt: Date | string | null,
): RefundDateCheck {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { ok: false };
  if (dateStr > today) return { ok: false };
  if (paidAt && dateStr < tashkentDateOf(paidAt)) return { ok: false };
  if (dateStr === today) return { ok: true, refundedAt: null };
  const { to } = tashkentDayWindow(dateStr);
  return { ok: true, refundedAt: new Date(to.getTime() - 59_999) };
}
