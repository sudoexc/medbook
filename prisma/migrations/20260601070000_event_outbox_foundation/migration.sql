-- Cross-surface sync v1, Phase A — EventOutbox foundation.
--
-- See `docs/TZ-cross-surface-sync.md` §5 and §8 for the full contract.
--
-- This migration is strictly additive:
--   * new table EventOutbox + enum OutboxStatus
--   * new nullable columns on AuditLog (eventId UNIQUE, surface, correlationId)
--   * new nullable column on Appointment (cancelledBy)
--
-- No existing column is renamed or dropped. Old code paths continue to work
-- against the pre-migration schema; new outbox-based code paths begin writing
-- to these columns once Phase A.6 (`confirmAppointment` pilot) is merged.

-- ─────────────────────────────────────────────────────────────────────────────
-- EventOutbox
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "OutboxStatus" AS ENUM (
  'PENDING',
  'DELIVERED',
  'FAILED',
  'DEAD'
);

CREATE TABLE "EventOutbox" (
  "id"              TEXT          NOT NULL,
  "correlationId"   TEXT          NOT NULL,
  "causedByEventId" TEXT,
  "clinicId"        TEXT          NOT NULL,
  "type"            TEXT          NOT NULL,
  "envelope"        JSONB         NOT NULL,
  "createdAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status"          "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "deliveredAt"     TIMESTAMP(3),
  "attempts"        INTEGER       NOT NULL DEFAULT 0,
  "lastError"       TEXT,

  CONSTRAINT "EventOutbox_pkey" PRIMARY KEY ("id")
);

-- Pumper poll: WHERE clinicId=? AND status='PENDING' ORDER BY createdAt LIMIT N
CREATE INDEX "EventOutbox_clinicId_status_createdAt_idx"
  ON "EventOutbox" ("clinicId", "status", "createdAt");

-- Replay cursor: /api/events?since=<eventId> reads DELIVERED rows since cursor.
CREATE INDEX "EventOutbox_clinicId_createdAt_idx"
  ON "EventOutbox" ("clinicId", "createdAt");

-- Trace cascade: WHERE correlationId=?
CREATE INDEX "EventOutbox_correlationId_idx"
  ON "EventOutbox" ("correlationId");

-- ─────────────────────────────────────────────────────────────────────────────
-- AuditLog enrichments — eventId/surface/correlationId
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "AuditLog"
  ADD COLUMN "eventId"       TEXT,
  ADD COLUMN "surface"       TEXT,
  ADD COLUMN "correlationId" TEXT;

-- UNIQUE so the pumper can use the eventId as an idempotency key when
-- materialising audit rows (a re-delivery of the same outbox row never
-- writes a duplicate audit log entry).
CREATE UNIQUE INDEX "AuditLog_eventId_key" ON "AuditLog" ("eventId");

CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog" ("correlationId");

-- ─────────────────────────────────────────────────────────────────────────────
-- Appointment.cancelledBy
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Appointment"
  ADD COLUMN "cancelledBy" TEXT;
