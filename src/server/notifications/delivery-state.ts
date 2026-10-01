/**
 * Pure rules of a NotificationSend row's delivery life (audit TG-08, TG-12).
 *
 * Shared by the send worker, the dispatch loop, the stuck-row sweep and the
 * staff «Повторить» endpoint, so «may this row be retried», «is this claim
 * stale» and «which BullMQ job is this attempt» have one answer each.
 * No Prisma here: everything is unit-testable on plain objects.
 */

/**
 * A row claimed (QUEUED → SENDING) longer ago than this is taken for
 * abandoned: the worker died between the claim and recording the outcome
 * (a deploy mid-send). A Telegram send is bounded by the bot API's
 * per-attempt timeouts, far below this.
 */
export const SENDING_STALE_MS = 10 * 60 * 1000;

/** Delivery attempts a row gets before it lands in FAILED. */
export const MAX_DELIVERY_ATTEMPTS = 3;

type ClaimState = {
  status: string;
  claimedAt?: Date | null;
  scheduledFor: Date;
};

/**
 * A SENDING row nobody is going to finish. Rows claimed before `claimedAt`
 * existed carry none; for them the due moment stands in, with the same
 * timeout, so a row the old worker had just claimed is not double-sent.
 */
export function isStaleSending(row: ClaimState, now: Date): boolean {
  if (row.status !== "SENDING") return false;
  const since = row.claimedAt ?? row.scheduledFor;
  return now.getTime() - since.getTime() > SENDING_STALE_MS;
}

/**
 * Whether staff may put the row back in the queue: it failed, or its send
 * was abandoned mid-flight. A SENT row would reach the patient twice, a
 * QUEUED one is already waiting, a fresh SENDING one is being sent right now
 * and a CANCELLED one was cancelled on purpose («Отправить ещё раз» makes a
 * new row for those).
 */
export function isRetryable(row: ClaimState, now: Date): boolean {
  return row.status === "FAILED" || isStaleSending(row, now);
}

/**
 * The appointment start a reminder row was written for, in ms, or null when
 * it cannot be known. Rows built since `appointmentAt` exists carry it; for
 * older rows of a cascade band it is `scheduledFor - offsetMin`, which holds
 * only while `scheduledFor` was never moved. Whoever moves `scheduledFor` of
 * such a row pins the anchor first (`pinnedAnchor`).
 */
export function reminderAnchorMs(
  send: { appointmentAt?: Date | null; scheduledFor: Date },
  offsetMin: unknown,
): number | null {
  if (send.appointmentAt) return send.appointmentAt.getTime();
  if (typeof offsetMin === "number" && Number.isFinite(offsetMin)) {
    return send.scheduledFor.getTime() - offsetMin * 60_000;
  }
  return null;
}

/**
 * `{ appointmentAt }` to write alongside a `scheduledFor` move, so a legacy
 * row's derived anchor survives the move; `{}` when there is nothing to pin.
 */
export function pinnedAnchor(send: {
  appointmentId?: string | null;
  appointmentAt?: Date | null;
  scheduledFor: Date;
  template?: { trigger?: string | null; triggerConfig?: unknown } | null;
}): { appointmentAt?: Date } {
  if (send.appointmentAt || !send.appointmentId) return {};
  if (send.template?.trigger !== "APPOINTMENT_BEFORE") return {};
  const offsetMin = (send.template.triggerConfig as { offsetMin?: unknown } | null)
    ?.offsetMin;
  const anchor = reminderAnchorMs(send, offsetMin);
  return anchor === null ? {} : { appointmentAt: new Date(anchor) };
}

/**
 * Dedupe key of one delivery attempt in the queue. The dispatch loop
 * re-offers every due row every few seconds; under one key the second offer
 * of the same attempt is a no-op instead of another job in Redis (audit
 * TG-12). The key only holds while that job waits or runs (BullMQ
 * `deduplication`, not `jobId`, which BullMQ keeps blocking for as long as it
 * retains the finished job), so an attempt that ended without a result is
 * offered again on the next pass. Every new attempt (backoff, rate-limit
 * deferral, staff retry, sweep) moves `scheduledFor` and so gets a new key,
 * even while the job that scheduled it is still running.
 */
export function deliveryAttemptKey(send: { id: string; scheduledFor: Date }): string {
  return `send-${send.id}-${send.scheduledFor.getTime()}`;
}
