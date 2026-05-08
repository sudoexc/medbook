/**
 * Phase 17 Wave 3 — DSAR review queue.
 *
 * Two tabs:
 *   1. "Экспорты" — list of recent DataExportJobs (status, patient, file
 *      size, expiry). Admin can request a fresh signed download URL for
 *      READY/DELIVERED jobs.
 *   2. "Удаления" — list of recent DataDeletionJobs (PENDING_REVIEW
 *      jobs go to the top so admins can approve / cancel them).
 *
 * Both tabs are fed by `/api/crm/dsar/*` ADMIN-only endpoints.
 */
import { DsarReviewClient } from "./_components/dsar-review-client";

export default function DsarReviewPage() {
  return <DsarReviewClient />;
}
