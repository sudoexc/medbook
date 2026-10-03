-- «Мой арсенал» (owner request 03.10.2026): every doctor's top 10/20/30 and
-- his own ordered arsenal with a usual schema per drug. Additive only:
--   * Doctor: how many «Частые» the visit screen shows, per kind. NOT NULL
--     DEFAULT 20, so every existing doctor gets the default and nothing
--     reads a null.
--   * DoctorFavorite: the optional schema of a drug pin. Nullable: existing
--     pins keep working exactly as before (no schema = what he wrote last).
--     The arsenal position is the existing sortOrder column.
--   * VisitNote: two indexes for the bounded reads of a doctor's last year
--     and of the clinic's last notes. The table is small, a plain CREATE
--     INDEX inside the migration transaction is a short lock.
-- AlterTable
ALTER TABLE "Doctor" ADD COLUMN     "frequentDiagnosisLimit" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "frequentDrugLimit" INTEGER NOT NULL DEFAULT 20;

-- AlterTable
ALTER TABLE "DoctorFavorite" ADD COLUMN     "schema" JSONB;

-- CreateIndex
CREATE INDEX "VisitNote_clinicId_doctorId_createdAt_idx" ON "VisitNote"("clinicId", "doctorId", "createdAt");

-- CreateIndex
CREATE INDEX "VisitNote_clinicId_createdAt_idx" ON "VisitNote"("clinicId", "createdAt");
