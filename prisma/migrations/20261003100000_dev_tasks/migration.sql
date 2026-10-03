-- «Задачи»: the clinic's request board for the CRM developers. The owner,
-- the desk and doctors file tasks (with screenshots); ADMIN / SUPER_ADMIN move
-- them NEW → IN_PROGRESS → DONE. Additive only: three new tables, two enums
-- and a per-clinic number counter starting at 0, so nothing existing changes.

-- CreateEnum
CREATE TYPE "DevTaskStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DevTaskPriority" AS ENUM ('NORMAL', 'HIGH', 'URGENT');

-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "devTaskCounter" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DevTask" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "DevTaskStatus" NOT NULL DEFAULT 'NEW',
    "priority" "DevTaskPriority" NOT NULL DEFAULT 'NORMAL',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "DevTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevTaskComment" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevTaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevTaskAttachment" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "thumbKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevTaskAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DevTask_clinicId_status_createdAt_idx" ON "DevTask"("clinicId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DevTask_clinicId_number_key" ON "DevTask"("clinicId", "number");

-- CreateIndex
CREATE INDEX "DevTaskComment_taskId_createdAt_idx" ON "DevTaskComment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "DevTaskComment_clinicId_createdAt_idx" ON "DevTaskComment"("clinicId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DevTaskAttachment_objectKey_key" ON "DevTaskAttachment"("objectKey");

-- CreateIndex
CREATE INDEX "DevTaskAttachment_taskId_createdAt_idx" ON "DevTaskAttachment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "DevTaskAttachment_clinicId_createdAt_idx" ON "DevTaskAttachment"("clinicId", "createdAt");

-- AddForeignKey
ALTER TABLE "DevTask" ADD CONSTRAINT "DevTask_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevTask" ADD CONSTRAINT "DevTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevTaskComment" ADD CONSTRAINT "DevTaskComment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevTaskComment" ADD CONSTRAINT "DevTaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "DevTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevTaskComment" ADD CONSTRAINT "DevTaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevTaskAttachment" ADD CONSTRAINT "DevTaskAttachment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevTaskAttachment" ADD CONSTRAINT "DevTaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "DevTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevTaskAttachment" ADD CONSTRAINT "DevTaskAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
