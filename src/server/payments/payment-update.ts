/**
 * What a change to a recorded payment may do (audit AN-11).
 *
 * PATCH /api/crm/payments/[id] used to write any field it was given: a
 * REFUNDED payment could go back to PAID, a refund could be "edited" into
 * another amount, and only a status flip recalculated the patient's LTV. The
 * desk had no way to fix a mistyped amount or record a refund at all.
 *
 * Two corrections exist now, each its own request:
 *   - «Исправить сумму» (ADMIN): a new `amount` for a payment nothing has
 *     been refunded from. The day's revenue changes with it: the old amount
 *     was a typo, not money that came in.
 *   - «Возврат»: a `refundedAmount` (> 0, at most the amount) with the date
 *     it was given back. One refund per payment, because a payment has one
 *     refund date (`Payment.refundedAt`). A full refund makes the payment
 *     REFUNDED, a partial one keeps it PAID.
 * Status moves: UNPAID and PARTIAL may move between each other and to PAID;
 * PAID leaves only through a refund; REFUNDED is final.
 *
 * Pure: the route loads the row, asks this module, then writes the returned
 * data with the loaded values as a precondition.
 */
export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED";

export type PaymentBefore = {
  status: PaymentStatus;
  amount: number;
  refundedAmount: number;
  refundedAt: Date | null;
  paidAt: Date | null;
};

export type PaymentPatch = {
  amount?: number;
  method?: string;
  status?: PaymentStatus;
  refundedAmount?: number;
  refundedAt?: Date | null;
  receiptNumber?: string | null;
  receiptUrl?: string | null;
  paidAt?: Date | null;
  externalRef?: string | null;
};

export type PaymentUpdatePlan =
  | {
      ok: true;
      data: Record<string, unknown>;
      /** amount, refund or status changed: the patient's LTV is stale. */
      moneyChanged: boolean;
    }
  | { ok: false; status: 403 | 409 | 422; reason: string };

const STATUS_MOVES: Record<PaymentStatus, ReadonlyArray<PaymentStatus>> = {
  UNPAID: ["PARTIAL", "PAID"],
  PARTIAL: ["UNPAID", "PAID"],
  // Once paid, a mistake is fixed by correcting the amount or by a refund.
  PAID: [],
  REFUNDED: [],
};

/** A refund dated a few minutes ahead is clock skew, not the future. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export function canCorrectAmount(role: string): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

export function planPaymentUpdate(
  before: PaymentBefore,
  patch: PaymentPatch,
  role: string,
  now: Date,
): PaymentUpdatePlan {
  const fail = (status: 403 | 409 | 422, reason: string): PaymentUpdatePlan => ({
    ok: false,
    status,
    reason,
  });

  const amountChange =
    typeof patch.amount === "number" && patch.amount !== before.amount;
  const refundChange =
    typeof patch.refundedAmount === "number" &&
    patch.refundedAmount !== before.refundedAmount;
  const statusChange =
    patch.status !== undefined && patch.status !== before.status;

  if (amountChange && refundChange) return fail(422, "one_change_at_a_time");
  if (patch.refundedAt !== undefined && !refundChange) {
    return fail(422, "refund_date_without_refund");
  }

  const data: Record<string, unknown> = {};
  for (const key of [
    "method",
    "receiptNumber",
    "receiptUrl",
    "paidAt",
    "externalRef",
  ] as const) {
    if (patch[key] !== undefined) data[key] = patch[key];
  }

  if (amountChange) {
    if (!canCorrectAmount(role)) return fail(403, "amount_admin_only");
    if (before.refundedAmount > 0 || before.status === "REFUNDED") {
      // The refund was given against the old amount.
      return fail(409, "amount_locked_after_refund");
    }
    data.amount = patch.amount;
  }

  let nextStatus: PaymentStatus = before.status;

  if (refundChange) {
    const refunded = patch.refundedAmount as number;
    if (before.status !== "PAID") return fail(409, "refund_needs_paid");
    if (before.refundedAmount > 0) return fail(409, "already_refunded");
    if (refunded <= 0) return fail(422, "refund_amount_invalid");
    if (refunded > before.amount) return fail(422, "refund_exceeds_amount");
    const at = patch.refundedAt ?? now;
    if (at.getTime() > now.getTime() + CLOCK_SKEW_MS) {
      return fail(422, "refund_date_invalid");
    }
    if (before.paidAt && at.getTime() < before.paidAt.getTime()) {
      return fail(422, "refund_date_invalid");
    }
    data.refundedAmount = refunded;
    data.refundedAt = at;
    nextStatus = refunded === before.amount ? "REFUNDED" : "PAID";
    // A status sent along must agree with what the refund makes it.
    if (statusChange && patch.status !== nextStatus) {
      return fail(422, "status_conflicts_with_refund");
    }
  } else if (statusChange) {
    const to = patch.status as PaymentStatus;
    if (to === "REFUNDED") return fail(422, "refund_needs_amount");
    if (!STATUS_MOVES[before.status].includes(to)) {
      return fail(409, "status_move_not_allowed");
    }
    nextStatus = to;
    if (to === "PAID" && patch.paidAt === undefined && !before.paidAt) {
      data.paidAt = now;
    }
  }

  if (nextStatus !== before.status) data.status = nextStatus;

  return {
    ok: true,
    data,
    moneyChanged: amountChange || refundChange || nextStatus !== before.status,
  };
}
