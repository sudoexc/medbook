-- Audit INF-04: the outbox pumper polls every clinic at once every 200 ms
-- and the new retention sweep deletes by status and age. Every existing
-- index started with clinicId, so each tick read the whole table. Index
-- only, no data change; safe on existing rows.

-- CreateIndex
CREATE INDEX "EventOutbox_status_createdAt_idx" ON "EventOutbox"("status", "createdAt");
