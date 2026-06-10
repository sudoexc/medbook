-- Ф2 (TZ-smart-constructor) — structured prescriptions on the Drug catalog.
-- Idempotent: guarded type creation + IF NOT EXISTS everywhere (house rule).

DO $$ BEGIN
    CREATE TYPE "MealRelation" AS ENUM ('BEFORE_MEAL', 'WITH_MEAL', 'AFTER_MEAL', 'EMPTY_STOMACH', 'NO_MATTER');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "VisitPrescription" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "visitNoteId" TEXT NOT NULL,
    "drugId" TEXT,
    "displayName" TEXT NOT NULL,
    "form" TEXT,
    "strength" TEXT,
    "dose" TEXT NOT NULL,
    "timesOfDay" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mealRelation" "MealRelation" NOT NULL DEFAULT 'NO_MATTER',
    "durationDays" INTEGER,
    "instructionRu" TEXT,
    "instructionUz" TEXT,
    "remindPatient" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitPrescription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VisitPrescription_clinicId_visitNoteId_idx"
    ON "VisitPrescription"("clinicId", "visitNoteId");

DO $$ BEGIN
    ALTER TABLE "VisitPrescription"
        ADD CONSTRAINT "VisitPrescription_visitNoteId_fkey"
        FOREIGN KEY ("visitNoteId") REFERENCES "VisitNote"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "VisitPrescription"
        ADD CONSTRAINT "VisitPrescription_drugId_fkey"
        FOREIGN KEY ("drugId") REFERENCES "Drug"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
