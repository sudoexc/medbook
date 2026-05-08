/**
 * Phase 17 Wave 3 — DSAR expiry helpers.
 *
 * Pure date-arithmetic helpers used by the export job lifecycle and the
 * deletion job lifecycle. Kept separate (and pure) so the worker / cron
 * code stays small and the rules are independently testable.
 *
 * Constants:
 *   EXPORT_TTL_DAYS    — how long an export bundle stays in MinIO before
 *                        the cron flips it to EXPIRED and (optionally)
 *                        deletes the object. Matches the spec: 30 days.
 *   DELETION_DELAY_DAYS — cooling-off period between request and
 *                        execution. 90 days mirrors GDPR / VINPF norms
 *                        and gives the patient ample time to change
 *                        their mind via the Mini App "Отменить" button.
 */

export const EXPORT_TTL_DAYS = 30;
export const DELETION_DELAY_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function exportExpiresAt(now: Date): Date {
  return new Date(now.getTime() + EXPORT_TTL_DAYS * MS_PER_DAY);
}

export function deletionScheduledFor(now: Date): Date {
  return new Date(now.getTime() + DELETION_DELAY_DAYS * MS_PER_DAY);
}

export function isExportExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function isDeletionDue(scheduledFor: Date, now: Date): boolean {
  return scheduledFor.getTime() <= now.getTime();
}
