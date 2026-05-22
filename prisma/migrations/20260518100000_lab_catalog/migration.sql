-- Phase G3 — LabTest + LabPanel + LabPanelTest + LabOrder

-- CreateEnum
CREATE TYPE "Biomaterial" AS ENUM ('BLOOD', 'SERUM', 'PLASMA', 'URINE', 'STOOL', 'SALIVA', 'SWAB', 'TISSUE', 'CSF', 'SPUTUM', 'OTHER');

-- CreateEnum
CREATE TYPE "LabOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'COLLECTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LabUrgency" AS ENUM ('ROUTINE', 'URGENT', 'STAT');

-- CreateTable
CREATE TABLE "LabTest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameUz" TEXT,
    "loinc" TEXT,
    "biomaterial" "Biomaterial" NOT NULL,
    "unit" TEXT,
    "refRanges" JSONB,
    "turnaroundHours" INTEGER NOT NULL DEFAULT 24,
    "priceUzs" INTEGER,
    "commonForCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "patientPrep" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LabTest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LabTest_code_key" ON "LabTest"("code");
CREATE INDEX "LabTest_active_sortOrder_idx" ON "LabTest"("active", "sortOrder");

-- CreateTable
CREATE TABLE "LabPanel" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameUz" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LabPanel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LabPanel_code_key" ON "LabPanel"("code");
CREATE INDEX "LabPanel_active_sortOrder_idx" ON "LabPanel"("active", "sortOrder");

-- CreateTable
CREATE TABLE "LabPanelTest" (
    "panelId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "LabPanelTest_pkey" PRIMARY KEY ("panelId", "testId")
);

CREATE INDEX "LabPanelTest_testId_idx" ON "LabPanelTest"("testId");

ALTER TABLE "LabPanelTest" ADD CONSTRAINT "LabPanelTest_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "LabPanel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LabPanelTest" ADD CONSTRAINT "LabPanelTest_testId_fkey" FOREIGN KEY ("testId") REFERENCES "LabTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "LabOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "visitNoteId" TEXT,
    "testCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "panelCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "diagnosisCode" TEXT,
    "notes" TEXT,
    "urgency" "LabUrgency" NOT NULL DEFAULT 'ROUTINE',
    "status" "LabOrderStatus" NOT NULL DEFAULT 'ORDERED',
    "printedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LabOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LabOrder_orderNumber_key" ON "LabOrder"("orderNumber");
CREATE INDEX "LabOrder_clinicId_patientId_createdAt_idx" ON "LabOrder"("clinicId", "patientId", "createdAt");
CREATE INDEX "LabOrder_clinicId_doctorId_createdAt_idx" ON "LabOrder"("clinicId", "doctorId", "createdAt");
CREATE INDEX "LabOrder_clinicId_status_createdAt_idx" ON "LabOrder"("clinicId", "status", "createdAt");

ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_visitNoteId_fkey" FOREIGN KEY ("visitNoteId") REFERENCES "VisitNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
