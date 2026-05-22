-- Phase G5 — patient handout library.

CREATE TABLE "HandoutTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "titleRu" TEXT NOT NULL,
    "titleUz" TEXT,
    "summaryRu" TEXT,
    "bodyMd" TEXT NOT NULL,
    "matchPrefixes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "topic" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandoutTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HandoutTemplate_code_key" ON "HandoutTemplate"("code");
CREATE INDEX "HandoutTemplate_active_sortOrder_idx" ON "HandoutTemplate"("active", "sortOrder");
