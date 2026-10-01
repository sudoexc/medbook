/**
 * What the call-center panel tells the operator about the caller (audit
 * CM-11). Pure and client-safe.
 *
 *   - «Следующая запись» is the NEAREST visit still ahead: booked, confirmed
 *     on the phone or waiting, from the start of today's clinic day. The
 *     panel used to search the card's last 10 visits, newest first, for
 *     BOOKED or WAITING only: it named the farthest visit (a control in a
 *     month instead of tomorrow's), skipped CONFIRMED (every phone booking),
 *     and could pick a stale BOOKED from last week.
 *   - «Средний чек» is the average price of the patient's completed visits
 *     over the whole history (the server's finance figure). It averaged the
 *     last 10 rows with no-shows counted as visits.
 *   - «Баланс» exists only where the clinic records payments in the CRM;
 *     elsewhere it is unknown, not zero.
 */
import { isUpcomingVisitStatus } from "@/lib/appointments/active-statuses";
import type { PatientFinance } from "@/lib/patients/finance";

export function pickNextAppointment<
  T extends { status: string; date: string | Date },
>(rows: readonly T[], dayStart: Date): T | null {
  const from = dayStart.getTime();
  let best: T | null = null;
  let bestAt = Infinity;
  for (const row of rows) {
    if (!isUpcomingVisitStatus(row.status)) continue;
    const at = new Date(row.date).getTime();
    if (!Number.isFinite(at) || at < from) continue;
    if (at < bestAt) {
      best = row;
      bestAt = at;
    }
  }
  return best;
}

/** Average completed-visit price in tiins, or null without completed visits. */
export function averageCheckOf(
  finance: Pick<PatientFinance, "visitsTotal" | "completedVisits"> | null | undefined,
): number | null {
  if (!finance || finance.completedVisits <= 0) return null;
  return Math.round(finance.visitsTotal / finance.completedVisits);
}

/** The balance to show, or null where payments are not recorded. */
export function knownBalanceOf(
  finance: Pick<PatientFinance, "tracksPayments" | "balance"> | null | undefined,
): number | null {
  if (!finance || !finance.tracksPayments) return null;
  return finance.balance;
}

/** The appointments page opens a visit's drawer from `?ap=`. */
export function appointmentDrawerHref(appointmentId: string, locale?: string): string {
  const prefix = locale ? `/${locale}` : "";
  return `${prefix}/crm/appointments?ap=${encodeURIComponent(appointmentId)}`;
}
