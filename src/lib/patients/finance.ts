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
 * the balance reads 0 until the clinic records its first payment.
 *
 * Client-safe: no server imports, so the card can import the type.
 */

/** The only status a visit is charged for. */
export const BILLABLE_VISIT_STATUS = "COMPLETED";

export type PatientFinance = {
  /** Sum of `priceFinal` over COMPLETED visits, тийин. */
  visitsTotal: number;
  /** How many COMPLETED visits went into `visitsTotal`. */
  completedVisits: number;
  /** PAID payments net of refunds, тийин (USD converted). */
  paid: number;
  /** Whether the clinic records payments in the CRM at all. */
  tracksPayments: boolean;
  /** What the patient still owes, тийин; null when payments are not recorded. */
  debt: number | null;
  /** paid - visitsTotal (negative: owes); 0 when payments are not recorded. */
  balance: number;
};

export type FinanceVisit = {
  status: string;
  priceFinal: number | null;
};

export function summarizePatientFinance(input: {
  visits: FinanceVisit[];
  /** PAID payments of the patient net of refunds, тийин. */
  paidTiyin: number;
  tracksPayments: boolean;
}): PatientFinance {
  let visitsTotal = 0;
  let completedVisits = 0;
  for (const v of input.visits) {
    if (v.status !== BILLABLE_VISIT_STATUS) continue;
    completedVisits += 1;
    visitsTotal += v.priceFinal ?? 0;
  }
  if (!input.tracksPayments) {
    return {
      visitsTotal,
      completedVisits,
      paid: 0,
      tracksPayments: false,
      debt: null,
      balance: 0,
    };
  }
  const paid = Math.max(0, input.paidTiyin);
  return {
    visitsTotal,
    completedVisits,
    paid,
    tracksPayments: true,
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
