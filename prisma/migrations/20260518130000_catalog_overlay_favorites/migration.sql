-- Phase G6 — Clinic overlay + Doctor favorites.

-- CreateEnum
CREATE TYPE "CatalogEntityType" AS ENUM ('DRUG', 'PROTOCOL', 'HANDOUT', 'LAB_TEST', 'LAB_PANEL');

-- CreateTable
CREATE TABLE "ClinicCatalogOverlay" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "entityType" "CatalogEntityType" NOT NULL,
    "entityCode" TEXT NOT NULL,
    "hideGlobal" BOOLEAN NOT NULL DEFAULT true,
    "overridesJson" JSONB,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicCatalogOverlay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClinicCatalogOverlay_clinicId_entityType_entityCode_key"
    ON "ClinicCatalogOverlay"("clinicId", "entityType", "entityCode");
CREATE INDEX "ClinicCatalogOverlay_clinicId_entityType_idx"
    ON "ClinicCatalogOverlay"("clinicId", "entityType");

-- AddForeignKey
ALTER TABLE "ClinicCatalogOverlay" ADD CONSTRAINT "ClinicCatalogOverlay_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "DoctorFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" "CatalogEntityType" NOT NULL,
    "entityCode" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoctorFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DoctorFavorite_userId_entityType_entityCode_key"
    ON "DoctorFavorite"("userId", "entityType", "entityCode");
CREATE INDEX "DoctorFavorite_userId_entityType_sortOrder_idx"
    ON "DoctorFavorite"("userId", "entityType", "sortOrder");

-- AddForeignKey
ALTER TABLE "DoctorFavorite" ADD CONSTRAINT "DoctorFavorite_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
