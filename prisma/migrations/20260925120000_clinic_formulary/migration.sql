-- Clinic core drug list («основные препараты клиники»).
CREATE TABLE "ClinicFormularyDrug" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "searchText" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicFormularyDrug_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicFormularyDrug_clinicId_drugId_key" ON "ClinicFormularyDrug"("clinicId", "drugId");
CREATE INDEX "ClinicFormularyDrug_clinicId_sortOrder_idx" ON "ClinicFormularyDrug"("clinicId", "sortOrder");

ALTER TABLE "ClinicFormularyDrug" ADD CONSTRAINT "ClinicFormularyDrug_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClinicFormularyDrug" ADD CONSTRAINT "ClinicFormularyDrug_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;
