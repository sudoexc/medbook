-- Ф1 (TZ-smart-constructor) — diagnosis knowledge base.
-- Idempotent: IF NOT EXISTS everywhere (house rule — reruns must be no-ops).

-- CatalogEntityType += GUIDE (overlay + favorites key for guides).
ALTER TYPE "CatalogEntityType" ADD VALUE IF NOT EXISTS 'GUIDE';

CREATE TABLE IF NOT EXISTS "DiagnosisGuide" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT,
    "code" TEXT NOT NULL,
    "matchPrefix" TEXT NOT NULL,
    "titleRu" TEXT NOT NULL,
    "titleUz" TEXT,
    "whatToDoRu" TEXT,
    "whatToDoUz" TEXT,
    "careRu" TEXT,
    "careUz" TEXT,
    "lifestyleRu" TEXT,
    "lifestyleUz" TEXT,
    "redFlagsRu" TEXT,
    "redFlagsUz" TEXT,
    "adviceChips" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultFollowUpDays" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagnosisGuide_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DiagnosisGuide_clinicId_code_key"
    ON "DiagnosisGuide"("clinicId", "code");

CREATE INDEX IF NOT EXISTS "DiagnosisGuide_matchPrefix_active_idx"
    ON "DiagnosisGuide"("matchPrefix", "active");
