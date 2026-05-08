-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "dormantSince" TIMESTAMP(3),
ADD COLUMN     "reactivationSentAt" TIMESTAMP(3)[];

-- CreateTable
CREATE TABLE "EmptySlotSnapshot" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "branchId" TEXT,
    "doctorId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "hour" INTEGER NOT NULL,
    "estimatedRevenueLossUzs" INTEGER NOT NULL,
    "takenSnapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmptySlotSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmptySlotSnapshot_clinicId_date_idx" ON "EmptySlotSnapshot"("clinicId", "date");

-- CreateIndex
CREATE INDEX "EmptySlotSnapshot_clinicId_doctorId_date_idx" ON "EmptySlotSnapshot"("clinicId", "doctorId", "date");

-- AddForeignKey
ALTER TABLE "EmptySlotSnapshot" ADD CONSTRAINT "EmptySlotSnapshot_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmptySlotSnapshot" ADD CONSTRAINT "EmptySlotSnapshot_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmptySlotSnapshot" ADD CONSTRAINT "EmptySlotSnapshot_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
