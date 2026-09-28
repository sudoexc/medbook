/**
 * What happens to a case's courses of medication when the case closes
 * (audit PT-10). The rule itself, without I/O: the case route applies it
 * in `src/server/medical-case/close-effects.ts`, the data fix for cases
 * closed before it in `scripts/fix-pt10-closed-case-prescriptions.ts`.
 *
 *   - RESOLVED: the treatment is over, the courses are COMPLETED;
 *   - ABANDONED / TRANSFERRED: the treatment did not run its course here,
 *     the courses are CANCELLED.
 *
 * Client-safe: no server imports.
 */

/** Courses that still run: the ones a closed case must end. */
export const RUNNING_PRESCRIPTION_STATUSES = ["ACTIVE", "PAUSED"] as const;

export function prescriptionStatusOnCaseClose(
  caseStatus: string,
): "COMPLETED" | "CANCELLED" | null {
  if (caseStatus === "RESOLVED") return "COMPLETED";
  if (caseStatus === "ABANDONED" || caseStatus === "TRANSFERRED") {
    return "CANCELLED";
  }
  return null;
}
