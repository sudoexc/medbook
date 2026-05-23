-- Purge orphan Document rows with `pending://` or `stub://` URLs.
-- These were written by the old presign flow when the upload couldn't issue a
-- real URL, leaving the bytes nowhere on disk and the row undownloadable.
-- The new /api/crm/documents/upload pipeline guarantees bytes land in storage
-- before the row is created, so any remaining pending://-prefixed rows are
-- pure orphans and safe to remove.

DELETE FROM "Document"
WHERE "fileUrl" LIKE 'pending://%'
   OR "fileUrl" LIKE 'stub://%';
