-- P1.1 — Conclusion → patient delivery.
--
-- Adds the CONCLUSION document type and a 1:1 link from an auto-generated
-- conclusion handout back to its VisitNote. The link is UNIQUE so the
-- visit-note-handout worker can upsert idempotently: a sweep retry, a worker
-- restart, or a redeploy must never plant a second conclusion for the same
-- finalized note.
--
-- Every statement is guarded (IF NOT EXISTS / duplicate_object) so the
-- migration is safe to re-run — matches the repo's idempotent-DDL house style
-- and survives a partially-applied deploy.

-- 1. New document type. ADD VALUE is transaction-safe on PG12+ provided the
--    value is not USED in the same transaction (it is not, here).
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'CONCLUSION' BEFORE 'CONSENT';

-- 2. Nullable back-pointer; only conclusion handouts set it.
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "visitNoteId" TEXT;

-- 3. One conclusion per note — the idempotency anchor for the worker upsert.
CREATE UNIQUE INDEX IF NOT EXISTS "Document_visitNoteId_key" ON "Document"("visitNoteId");

-- 4. FK with ON DELETE SET NULL: deleting a note must not cascade away a
--    document the patient may already be holding. The guard makes the
--    constraint add idempotent across re-runs.
DO $$
BEGIN
  ALTER TABLE "Document"
    ADD CONSTRAINT "Document_visitNoteId_fkey"
    FOREIGN KEY ("visitNoteId") REFERENCES "VisitNote"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;
