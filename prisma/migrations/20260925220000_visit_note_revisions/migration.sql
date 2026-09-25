-- Audit G1-01: immutable versions of a signed conclusion (before/after of
-- every in-window correction, and the PDF each version was rendered to).
-- CreateTable
CREATE TABLE "VisitNoteRevision" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "visitNoteId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content" JSONB NOT NULL,
    "pdfObjectKey" TEXT,
    "authorUserId" TEXT,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitNoteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisitNoteRevision_clinicId_visitNoteId_idx" ON "VisitNoteRevision"("clinicId", "visitNoteId");

-- CreateIndex
CREATE UNIQUE INDEX "VisitNoteRevision_visitNoteId_revision_key" ON "VisitNoteRevision"("visitNoteId", "revision");

-- AddForeignKey
ALTER TABLE "VisitNoteRevision" ADD CONSTRAINT "VisitNoteRevision_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitNoteRevision" ADD CONSTRAINT "VisitNoteRevision_visitNoteId_fkey" FOREIGN KEY ("visitNoteId") REFERENCES "VisitNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

