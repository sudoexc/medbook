/**
 * Values for the booking-conflict messages «Врач занят до 14:30» (audit
 * UX-07).
 *
 * The messages switched on the time itself with an empty select case,
 * `{until, select, , {} other{ до {until}}}`. That is not valid ICU: the
 * parser throws, next-intl falls back to the key, and the front desk saw
 * «calendar.conflict.doctor_busy» instead of the reason a move was refused.
 * ICU cannot test a value for emptiness, so the caller says whether there is
 * a time: `{hasUntil, select, yes { до {until}} other {}}`.
 *
 * Every message of the conflict namespaces gets the same values; the ones
 * without a time simply ignore them.
 */
export type ConflictMessageValues = {
  until: string;
  hasUntil: "yes" | "no";
};

export function conflictMessageValues(
  until: string | null | undefined,
): ConflictMessageValues {
  const clock = (until ?? "").trim();
  return { until: clock, hasUntil: clock ? "yes" : "no" };
}

/** The next-intl translator of a conflict namespace, as the mapper uses it. */
export type ConflictTranslator = {
  (key: string, values?: ConflictMessageValues): string;
  has(key: string): boolean;
};

/**
 * A refused appointment write, in the operator's words (audit AP-18): the
 * server's `reason` when the namespace has a message for it, otherwise the
 * caller's generic line. Raw codes («conflict:another_visit_in_progress»,
 * «HTTP 409», «Forbidden») never reach a toast, and a reason without a
 * message no longer shows next-intl's bare key.
 */
export function conflictReasonText(
  t: ConflictTranslator,
  reason: string | null | undefined,
  until: string | null | undefined,
  fallback: string,
): string {
  if (!reason || !t.has(reason)) return fallback;
  return t(reason, conflictMessageValues(until));
}
