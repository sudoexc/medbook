-- CreateEnum
CREATE TYPE "DrugCategory" AS ENUM (
  'ANTIBIOTIC',
  'ANALGESIC',
  'ANTIPYRETIC',
  'NSAID',
  'ANTIHISTAMINE',
  'GI',
  'CARDIO',
  'RESPIRATORY',
  'VITAMIN',
  'SEDATIVE',
  'ENDOCRINE',
  'DIURETIC',
  'ANTIEMETIC',
  'ANTISPASMODIC',
  'STEROID',
  'TOPICAL',
  'EYE_EAR',
  'UROLOGY',
  'NEUROLOGICAL',
  'PSYCHIATRIC',
  'ANTIFUNGAL',
  'ANTIVIRAL',
  'HORMONAL',
  'DERMATOLOGICAL',
  'HEMATOLOGY',
  'OPHTHALMIC',
  'GYNECOLOGY',
  'VACCINE',
  'OTHER'
);

-- CreateEnum
CREATE TYPE "PregnancyCategory" AS ENUM ('A', 'B', 'C', 'D', 'X', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Drug" (
    "id" TEXT NOT NULL,
    "inn" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameUz" TEXT,
    "atcCode" TEXT,
    "category" "DrugCategory" NOT NULL,
    "forms" JSONB NOT NULL,
    "indications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contraindications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sideEffects" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pregnancyCat" "PregnancyCategory" NOT NULL DEFAULT 'UNKNOWN',
    "defaultDosing" JSONB,
    "rxOnly" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Drug_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugBrand" (
    "id" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrugBrand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Drug_inn_key" ON "Drug"("inn");

-- CreateIndex
CREATE INDEX "Drug_category_active_idx" ON "Drug"("category", "active");

-- CreateIndex
CREATE INDEX "Drug_atcCode_idx" ON "Drug"("atcCode");

-- CreateIndex
CREATE INDEX "DrugBrand_drugId_idx" ON "DrugBrand"("drugId");

-- CreateIndex
CREATE INDEX "DrugBrand_name_idx" ON "DrugBrand"("name");

-- AddForeignKey
ALTER TABLE "DrugBrand" ADD CONSTRAINT "DrugBrand_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;
