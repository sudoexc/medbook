-- CreateTable
CREATE TABLE "ClinicalProtocol" (
    "id" TEXT NOT NULL,
    "diagnosisCodePrefix" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameUz" TEXT,
    "summaryRu" TEXT,
    "complaintsTemplate" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "anamnesisTemplate" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "examinationTemplate" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prescriptionsTemplate" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "adviceTemplate" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recommendedLabs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "conclusionTemplateMd" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicalProtocol_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClinicalProtocol_diagnosisCodePrefix_active_idx" ON "ClinicalProtocol"("diagnosisCodePrefix", "active");
