-- Phase G4 — drug-drug interaction registry.

CREATE TYPE "DrugInteractionSeverity" AS ENUM ('MINOR', 'MODERATE', 'MAJOR', 'CONTRAINDICATED');

CREATE TABLE "DrugInteraction" (
    "id" TEXT NOT NULL,
    "drugAId" TEXT NOT NULL,
    "drugBId" TEXT NOT NULL,
    "severity" "DrugInteractionSeverity" NOT NULL,
    "mechanism" TEXT,
    "advice" TEXT NOT NULL,
    "riskDiagnoses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrugInteraction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DrugInteraction_drugAId_drugBId_key" ON "DrugInteraction"("drugAId", "drugBId");
CREATE INDEX "DrugInteraction_drugAId_idx" ON "DrugInteraction"("drugAId");
CREATE INDEX "DrugInteraction_drugBId_idx" ON "DrugInteraction"("drugBId");

ALTER TABLE "DrugInteraction"
    ADD CONSTRAINT "DrugInteraction_drugAId_fkey"
    FOREIGN KEY ("drugAId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DrugInteraction"
    ADD CONSTRAINT "DrugInteraction_drugBId_fkey"
    FOREIGN KEY ("drugBId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;
