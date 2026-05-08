/**
 * Phase 17 Wave 1 — Consent gate.
 *
 * Single decision point invoked at every patient-targeted notification
 * send-site to decide whether the push is allowed under the patient's
 * compliance flags.
 *
 * Distinct kinds:
 *   - `transactional` — appointment confirmation / reminders / cancel /
 *     pre-visit questionnaire. Tied to a service the patient explicitly
 *     booked. Always allowed unless the patient is soft-deleted.
 *   - `marketing`     — reactivation, NPS, medication reminder, birthday,
 *     referral reward, future broadcasts. Gated on `marketingOptOut`.
 *
 * Rules:
 *   1. `deletedAt != null`        → never allowed (regardless of kind).
 *   2. `kind === 'transactional'` → allowed (when not deleted).
 *   3. `kind === 'marketing'`     → allowed unless `marketingOptOut === true`.
 *   4. `marketingOptOut === null` (legacy data) is treated as `false` —
 *      patients who never explicitly opted out are still in scope.
 *
 * Pure helper. Do not log inside; callers decide whether to skip silently
 * or surface the gate decision.
 */
export type ConsentKind = "transactional" | "marketing";

export type ConsentDecision = {
  allowed: boolean;
  reason?: "deleted" | "opted_out";
};

export function isAllowedToReceive(
  patient: { marketingOptOut: boolean | null; deletedAt: Date | null },
  kind: ConsentKind,
): ConsentDecision {
  if (patient.deletedAt !== null && patient.deletedAt !== undefined) {
    return { allowed: false, reason: "deleted" };
  }
  if (kind === "transactional") {
    return { allowed: true };
  }
  // marketing
  if (patient.marketingOptOut === true) {
    return { allowed: false, reason: "opted_out" };
  }
  return { allowed: true };
}
