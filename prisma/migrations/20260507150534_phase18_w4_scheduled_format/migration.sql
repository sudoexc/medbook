-- Phase 18 Wave 4 — scheduled-report delivery format.
--
-- Add `ScheduledReport.format` (string, default "pdf") so a single scheduled
-- row can ship either a PDF or CSV attachment. We intentionally use a free
-- TEXT column instead of a Postgres enum so future formats (xlsx, html email
-- body) can land without another migration — the API layer enforces the
-- allowed values via zod.
ALTER TABLE "ScheduledReport"
  ADD COLUMN "format" TEXT NOT NULL DEFAULT 'pdf',
  -- Consecutive-failure counter. The W4 worker auto-disables a row after 3
  -- in a row and audits SCHEDULED_REPORT_DISABLED_AFTER_FAILURES; reset to
  -- 0 on every successful delivery.
  ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;
