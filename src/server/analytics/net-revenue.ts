/**
 * Revenue net of refunds (audit AN-11).
 *
 * Every revenue figure used to sum `amount` over `status: "PAID"`. A partial
 * refund (`refundedAmount`) was never subtracted, and turning a payment into
 * REFUNDED afterwards removed it from the day the money came in, rewriting
 * a closed day's cash.
 *
 * The rule now, shared by the analytics, the dashboard, the financial pace
 * card (live and the materialized view in
 * prisma/migrations/20261001110000_payments_billing_platform) and the loss
 * report:
 *   - a PAID or REFUNDED payment counts on its `paidAt` day, in full;
 *   - its refund is subtracted on its `refundedAt` day.
 * So a refund lowers the day it was given back and leaves the original day
 * as it was. A fully refunded payment nets to zero across the two days.
 */

/** Payments whose money came in, whatever happened to it later. */
export const REVENUE_PAYMENT_STATUSES = ["PAID", "REFUNDED"] as const;

type Window = { from: Date; to: Date };

/** Payments taken during [from, to). */
export function collectedWhere(w: Window) {
  return {
    status: { in: [...REVENUE_PAYMENT_STATUSES] },
    paidAt: { gte: w.from, lt: w.to },
  };
}

/** Refunds given back during [from, to). */
export function refundedWhere(w: Window) {
  return {
    status: { in: [...REVENUE_PAYMENT_STATUSES] },
    refundedAmount: { gt: 0 },
    refundedAt: { gte: w.from, lt: w.to },
  };
}

export type CollectedRow = { amount: number; paidAt: Date | null };
export type RefundRow = {
  refundedAmount?: number | null;
  refundedAt?: Date | null;
};

/**
 * Signed money moves: `+amount` on the paid day, `-refundedAmount` on the
 * refund day. Rows without a date are skipped (an UNPAID row has none).
 */
export function revenueMoves(
  collected: ReadonlyArray<CollectedRow>,
  refunds: ReadonlyArray<RefundRow>,
): Array<{ at: Date; amount: number }> {
  const out: Array<{ at: Date; amount: number }> = [];
  for (const p of collected) {
    if (p.paidAt) out.push({ at: p.paidAt, amount: p.amount });
  }
  for (const r of refunds) {
    if (r.refundedAt && r.refundedAmount && r.refundedAmount > 0) {
      out.push({ at: r.refundedAt, amount: -r.refundedAmount });
    }
  }
  return out;
}

type AggregateDb = {
  payment: {
    aggregate: (args: never) => Promise<{
      _sum: { amount?: number | null; refundedAmount?: number | null };
    }>;
  };
};

/**
 * Net revenue over [from, to): taken minus given back. `extra` narrows both
 * sides the same way (branch / doctor scope, currency, clinic).
 */
export async function sumNetRevenue(
  db: AggregateDb,
  w: Window,
  extra: Record<string, unknown> = {},
): Promise<number> {
  const collected = await db.payment.aggregate({
    where: { ...collectedWhere(w), ...extra },
    _sum: { amount: true },
  } as never);
  const refunded = await db.payment.aggregate({
    where: { ...refundedWhere(w), ...extra },
    _sum: { refundedAmount: true },
  } as never);
  return (collected._sum.amount ?? 0) - (refunded._sum.refundedAmount ?? 0);
}
