-- Patient-facing handout markdown for the deterministic constructor.
-- Independent from VisitNote.bodyMarkdown (clinical record) — the handout
-- is composed by templating from structured fields, then editable.
ALTER TABLE "VisitNote" ADD COLUMN "patientHandoutMarkdown" TEXT;
