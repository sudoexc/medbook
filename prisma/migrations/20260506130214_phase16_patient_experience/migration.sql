-- CreateTable
CREATE TABLE "PatientReview" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "doctorId" TEXT,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "source" TEXT NOT NULL,
    "adminAlerted" BOOLEAN NOT NULL DEFAULT false,
    "adminAlertedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientFamily" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "ownerPatientId" TEXT NOT NULL,
    "linkedPatientId" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "drugName" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "schedule" JSONB NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralCode" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "referrerPatientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientReview_clinicId_score_respondedAt_idx" ON "PatientReview"("clinicId", "score", "respondedAt");

-- CreateIndex
CREATE INDEX "PatientReview_clinicId_doctorId_respondedAt_idx" ON "PatientReview"("clinicId", "doctorId", "respondedAt");

-- CreateIndex
CREATE INDEX "PatientReview_appointmentId_idx" ON "PatientReview"("appointmentId");

-- CreateIndex
CREATE INDEX "PatientFamily_clinicId_ownerPatientId_idx" ON "PatientFamily"("clinicId", "ownerPatientId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientFamily_ownerPatientId_linkedPatientId_key" ON "PatientFamily"("ownerPatientId", "linkedPatientId");

-- CreateIndex
CREATE INDEX "Prescription_clinicId_patientId_status_idx" ON "Prescription"("clinicId", "patientId", "status");

-- CreateIndex
CREATE INDEX "Prescription_clinicId_caseId_idx" ON "Prescription"("clinicId", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_code_key" ON "ReferralCode"("code");

-- CreateIndex
CREATE INDEX "ReferralCode_clinicId_referrerPatientId_idx" ON "ReferralCode"("clinicId", "referrerPatientId");

-- AddForeignKey
ALTER TABLE "PatientReview" ADD CONSTRAINT "PatientReview_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientReview" ADD CONSTRAINT "PatientReview_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientReview" ADD CONSTRAINT "PatientReview_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientReview" ADD CONSTRAINT "PatientReview_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientFamily" ADD CONSTRAINT "PatientFamily_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientFamily" ADD CONSTRAINT "PatientFamily_ownerPatientId_fkey" FOREIGN KEY ("ownerPatientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientFamily" ADD CONSTRAINT "PatientFamily_linkedPatientId_fkey" FOREIGN KEY ("linkedPatientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "MedicalCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_referrerPatientId_fkey" FOREIGN KEY ("referrerPatientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECK constraint: PatientFamily self-link is rejected (DB-level guard
-- complementing the app-layer Zod check). A patient cannot be linked to
-- themselves as a family member.
ALTER TABLE "PatientFamily" ADD CONSTRAINT "PatientFamily_no_self_link"
  CHECK ("ownerPatientId" <> "linkedPatientId");

-- CHECK constraint: PatientReview NPS score range. Belt-and-suspenders for
-- the Zod validation in /api/miniapp/family — direct DB writes still get
-- caught.
ALTER TABLE "PatientReview" ADD CONSTRAINT "PatientReview_score_range"
  CHECK ("score" >= 1 AND "score" <= 10);
