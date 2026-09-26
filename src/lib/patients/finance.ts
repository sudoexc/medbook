/**
 * A patient's money on one formula (audit PT-08).
 *
 * The patient card used to show three unrelated figures: «Финансы» summed
 * `priceFinal` over every appointment (cancelled, no-show and next week's
 * booking included) minus only the payments filed under a visit; «Оплаты»
 * and the call-center / Telegram rails read `Patient.balance`, a column no
 * code path ever writes. A patient booked for next week who once cancelled
 * read «Долг: 600 000 сум» while owing nothing.
 *
 * Now there is one definition, computed on the server:
 *   - what the visits cost: `priceFinal` of COMPLETED visits only. A
 *     cancelled visit, a no-show and a future booking cost nothing;
 *   - what was paid: every PAID payment of the patient, filed under a visit
 *     or not (a deposit), net of refunds, in тийин;
 *   - balance = paid - cost (negative: the patient owes).
 *
 * The clinic may not record payments in the CRM at all (this one does not:
 * money is taken at the till). Then «paid» is zero for everyone and the
 * formula would name every patient a debtor, so debt is unknown (null) and
 * the balance reads 0 until an admin turns on «Учёт оплат в CRM». Never
 * inferred from the payments: one payment entered in the drawer used to
 * switch it on and turn every later walk-in paid at the till into debt.
 *
 * Once it is on, only visits from that moment on are charged
 * (`billingSince`, when it was turned on): the visits before it were paid
 * at the till and never entered, so charging them would turn every earlier
 * patient into a debtor that day. A visit with a payment filed under it is
 * charged whenever it happened, so a visit paid the day after is settled
 * rather than read as credit.
 *
 * Client-safe: no server imports, so the card can import the type.
 */

/** The only status a visit is charged for. */
export const BILLABLE_VISIT_STATUS = "COMPLETED";

export type PatientFinance = {
  /**
   * Sum of `priceFinal` over the visits the patient is charged for, тийин:
   * every COMPLETED visit while payments are not recorded, the billed ones
   * (see `isBilledVisit`) once they are.
   */
  visitsTotal: number;
  /** How many visits went into `visitsTotal`. */
  completedVisits: number;
  /** COMPLETED visits left out because they predate `billingSince`. */
  unbilledVisits: number;
  /** PAID payments net of refunds, тийин (USD converted). */
  paid: number;
  /** Whether the clinic records payments in the CRM at all. */
  tracksPayments: boolean;
  /**
   * ISO time «Учёт оплат в CRM» was turned on; visits completed before it
   * are not charged. Null when payments are not tracked.
   */
  billingSince: string | null;
  /** What the patient still owes, тийин; null when payments are not recorded. */
  debt: number | null;
  /** paid - visitsTotal (negative: owes); 0 when payments are not recorded. */
  balance: number;
};

export type FinanceVisit = {
  status: string;
  priceFinal: number | null;
  /** When the visit was completed; older rows may lack it, then `date` counts. */
  completedAt?: Date | string | null;
  /** The visit's start. */
  date: Date | string;
  /** Whether a PAID payment is filed under this visit. */
  hasPaidPayment?: boolean;
};

/**
 * Whether the patient is charged for this visit, given when the clinic
 * started recording payments (null: it does not). The server's
 * `billedVisitWhere` is the same rule as a Prisma filter for the list.
 */
export function isBilledVisit(
  visit: FinanceVisit,
  billingSince: Date | string | null,
): boolean {
  if (visit.status !== BILLABLE_VISIT_STATUS || billingSince === null) {
    return false;
  }
  if (visit.hasPaidPayment) return true;
  const at = new Date(visit.completedAt ?? visit.date).getTime();
  return at >= new Date(billingSince).getTime();
}

/**
 * A charged visit with no PAID payment filed under it: the «Визиты» tab
 * paints its price red and says «Долг».
 */
export function isOwedVisit(
  visit: FinanceVisit,
  billingSince: Date | string | null,
): boolean {
  return !visit.hasPaidPayment && isBilledVisit(visit, billingSince);
}

export function summarizePatientFinance(input: {
  visits: FinanceVisit[];
  /** PAID payments of the patient net of refunds, тийин. */
  paidTiyin: number;
  /** When the clinic started recording payments; null: it does not. */
  billingSince: Date | string | null;
}): PatientFinance {
  const { billingSince } = input;
  let visitsTotal = 0;
  let completedVisits = 0;
  let unbilledVisits = 0;
  for (const v of input.visits) {
    if (v.status !== BILLABLE_VISIT_STATUS) continue;
    if (billingSince !== null && !isBilledVisit(v, billingSince)) {
      unbilledVisits += 1;
      continue;
    }
    completedVisits += 1;
    visitsTotal += v.priceFinal ?? 0;
  }
  if (billingSince === null) {
    return {
      visitsTotal,
      completedVisits,
      unbilledVisits: 0,
      paid: 0,
      tracksPayments: false,
      billingSince: null,
      debt: null,
      balance: 0,
    };
  }
  const paid = Math.max(0, input.paidTiyin);
  return {
    visitsTotal,
    completedVisits,
    unbilledVisits,
    paid,
    tracksPayments: true,
    billingSince: new Date(billingSince).toISOString(),
    debt: Math.max(0, visitsTotal - paid),
    balance: paid - visitsTotal,
  };
}

/** The list filter's buckets, on the same balance. */
export type BalanceBucket = "debt" | "zero" | "credit";

export function balanceBucketOf(balance: number): BalanceBucket {
  if (balance < 0) return "debt";
  if (balance > 0) return "credit";
  return "zero";
}
