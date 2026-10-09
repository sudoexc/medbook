-- «Позвать регистратуру» (owner request 09.10.2026): a doctor's call to the
-- desk, answered «Иду» from any reception screen. Additive only.
-- CreateTable
CREATE TABLE "StaffCall" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "createdById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "ackedById" TEXT,
    "ackedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "StaffCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffCall_clinicId_status_createdAt_idx" ON "StaffCall"("clinicId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "StaffCall_doctorId_createdAt_idx" ON "StaffCall"("doctorId", "createdAt");

-- AddForeignKey
ALTER TABLE "StaffCall" ADD CONSTRAINT "StaffCall_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCall" ADD CONSTRAINT "StaffCall_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
