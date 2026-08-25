-- Amendments (исправления) to finalized conclusions + stale-PDF re-render anchor.
--
-- Prod-safe by construction: one new empty table and one nullable column.
-- No existing row is read, rewritten or backfilled — a finalized conclusion
-- is an issued legal document and this migration must not touch it.

-- Non-null = the rendered CONCLUSION PDF is stale (note edited inside the 24h
-- window, or an amendment appended) and the handout worker must re-render.
ALTER TABLE "VisitNote" ADD COLUMN "handoutStaleAt" TIMESTAMP(3);

CREATE TABLE "VisitNoteAmendment" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "visitNoteId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitNoteAmendment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VisitNoteAmendment_clinicId_visitNoteId_createdAt_idx"
    ON "VisitNoteAmendment"("clinicId", "visitNoteId", "createdAt");

ALTER TABLE "VisitNoteAmendment"
    ADD CONSTRAINT "VisitNoteAmendment_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Cascade with the note (mirrors VisitPrescription); the note itself is
-- delete-protected upstream via the Patient → VisitNote RESTRICT.
ALTER TABLE "VisitNoteAmendment"
    ADD CONSTRAINT "VisitNoteAmendment_visitNoteId_fkey"
    FOREIGN KEY ("visitNoteId") REFERENCES "VisitNote"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict: the amending doctor must survive as long as their amendments do.
ALTER TABLE "VisitNoteAmendment"
    ADD CONSTRAINT "VisitNoteAmendment_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
