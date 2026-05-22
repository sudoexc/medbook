-- CreateEnum
CREATE TYPE "EPrescriptionStatus" AS ENUM ('ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SickLeaveRegimen" AS ENUM ('OUTPATIENT', 'HOSPITAL', 'HOME');

-- CreateEnum
CREATE TYPE "SickLeaveStatus" AS ENUM ('ISSUED', 'CANCELLED');

-- CreateTable
CREATE TABLE "EPrescription" (
    "id" TEXT NOT NULL,
    "rxNumber" TEXT NOT NULL,
    "verifyToken" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "visitNoteId" TEXT,
    "diagnosisCode" TEXT,
    "diagnosisName" TEXT,
    "signatureUrl" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntilAt" TIMESTAMP(3) NOT NULL,
    "printedAt" TIMESTAMP(3),
    "status" "EPrescriptionStatus" NOT NULL DEFAULT 'ISSUED',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EPrescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SickLeave" (
    "id" TEXT NOT NULL,
    "certNumber" TEXT NOT NULL,
    "verifyToken" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "visitNoteId" TEXT,
    "diagnosisCode" TEXT,
    "diagnosisName" TEXT,
    "signatureUrl" TEXT,
    "regimen" "SickLeaveRegimen" NOT NULL DEFAULT 'OUTPATIENT',
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "restrictions" TEXT,
    "notes" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedAt" TIMESTAMP(3),
    "status" "SickLeaveStatus" NOT NULL DEFAULT 'ISSUED',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SickLeave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EPrescription_rxNumber_key" ON "EPrescription"("rxNumber");
CREATE UNIQUE INDEX "EPrescription_verifyToken_key" ON "EPrescription"("verifyToken");
CREATE INDEX "EPrescription_clinicId_patientId_createdAt_idx" ON "EPrescription"("clinicId", "patientId", "createdAt");
CREATE INDEX "EPrescription_clinicId_doctorId_createdAt_idx" ON "EPrescription"("clinicId", "doctorId", "createdAt");
CREATE INDEX "EPrescription_clinicId_status_createdAt_idx" ON "EPrescription"("clinicId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SickLeave_certNumber_key" ON "SickLeave"("certNumber");
CREATE UNIQUE INDEX "SickLeave_verifyToken_key" ON "SickLeave"("verifyToken");
CREATE INDEX "SickLeave_clinicId_patientId_createdAt_idx" ON "SickLeave"("clinicId", "patientId", "createdAt");
CREATE INDEX "SickLeave_clinicId_doctorId_createdAt_idx" ON "SickLeave"("clinicId", "doctorId", "createdAt");
CREATE INDEX "SickLeave_clinicId_status_periodFrom_idx" ON "SickLeave"("clinicId", "status", "periodFrom");

-- AddForeignKey
ALTER TABLE "EPrescription" ADD CONSTRAINT "EPrescription_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EPrescription" ADD CONSTRAINT "EPrescription_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EPrescription" ADD CONSTRAINT "EPrescription_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EPrescription" ADD CONSTRAINT "EPrescription_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EPrescription" ADD CONSTRAINT "EPrescription_visitNoteId_fkey" FOREIGN KEY ("visitNoteId") REFERENCES "VisitNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SickLeave" ADD CONSTRAINT "SickLeave_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SickLeave" ADD CONSTRAINT "SickLeave_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SickLeave" ADD CONSTRAINT "SickLeave_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SickLeave" ADD CONSTRAINT "SickLeave_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SickLeave" ADD CONSTRAINT "SickLeave_visitNoteId_fkey" FOREIGN KEY ("visitNoteId") REFERENCES "VisitNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
