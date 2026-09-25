/**
 * Which visit a payment is for (audit AN-02).
 *
 * Every visit-level money figure reads `Payment.appointmentId`: the doctor's
 * revenue and «Топ врачей», the visit drawer's payments, the «Неоплаченные»
 * filter, the paid-visit price lock. The patient card's payment dialog never
 * sent it, so all of them showed nothing for real payments. The dialog now
 * offers the patient's visits and preselects the one the money is most
 * likely for; staff can pick another or none (a deposit).
 */
import { tashkentPartsOf } from "@/lib/tashkent-time";

export type PaymentVisit = {
  id: string;
  date: string | Date;
  status: string;
  priceFinal: number | null;
  payments: Array<{ amount: number; status: string }>;
};

/** Visits nobody pays for: the patient never came. */
const NOT_PAYABLE = new Set(["CANCELLED", "NO_SHOW"]);

/** How far back a visit is still a sensible default for today's payment. */
const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

function timeOf(v: PaymentVisit): number {
  return new Date(v.date).getTime();
}

/** Sum of the visit's PAID payments, in тийин. */
export function paidTiyin(v: PaymentVisit): number {
  return v.payments
    .filter((p) => p.status === "PAID")
    .reduce((acc, p) => acc + p.amount, 0);
}

/** What is still owed for the visit, in тийин (never negative). */
export function outstandingTiyin(v: PaymentVisit): number {
  return Math.max(0, (v.priceFinal ?? 0) - paidTiyin(v));
}

/**
 * Nothing left to take: paid in full, or free (a free repeat is priced 0).
 * A visit not priced yet (null) is open until something is paid.
 */
export function isSettled(v: PaymentVisit): boolean {
  if (v.priceFinal === 0) return true;
  const paid = paidTiyin(v);
  if (v.priceFinal === null) return paid > 0;
  return paid >= v.priceFinal;
}

/** The visits a payment can be filed under, newest first. */
export function payableVisits<T extends PaymentVisit>(visits: T[]): T[] {
  return visits
    .filter((v) => !NOT_PAYABLE.has(v.status))
    .sort((a, b) => timeOf(b) - timeOf(a));
}

/**
 * The visit to preselect, or null for «no visit»:
 *   1. an unsettled visit today (Tashkent day), the one nearest to now:
 *      the patient at the desk pays for the visit he came for, before or
 *      after it;
 *   2. otherwise the latest unsettled visit of the past week;
 *   3. otherwise none. An older visit or a future one is picked by hand,
 *      never guessed.
 */
export function defaultPaymentVisitId(
  visits: PaymentVisit[],
  now: Date = new Date(),
): string | null {
  const open = payableVisits(visits).filter((v) => !isSettled(v));
  const nowMs = now.getTime();
  const today = tashkentPartsOf(now).date;

  const todays = open.filter((v) => tashkentPartsOf(v.date).date === today);
  if (todays.length > 0) {
    const nearest = [...todays].sort(
      (a, b) => Math.abs(timeOf(a) - nowMs) - Math.abs(timeOf(b) - nowMs),
    )[0];
    return nearest.id;
  }

  const recent = open.find(
    (v) => timeOf(v) <= nowMs && nowMs - timeOf(v) <= DEFAULT_LOOKBACK_MS,
  );
  return recent?.id ?? null;
}
