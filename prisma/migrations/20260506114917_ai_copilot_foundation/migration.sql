-- AlterTable
ALTER TABLE "MedicalCase" ADD COLUMN     "soapDraft" TEXT;

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "summaryCache" TEXT,
ADD COLUMN     "summaryCacheUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LLMUsage" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "userId" TEXT,
    "useCase" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costUzs" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LLMUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LLMUsage_clinicId_createdAt_idx" ON "LLMUsage"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "LLMUsage_clinicId_useCase_createdAt_idx" ON "LLMUsage"("clinicId", "useCase", "createdAt");

-- AddForeignKey
ALTER TABLE "LLMUsage" ADD CONSTRAINT "LLMUsage_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
