-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "branchId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assigneeRole" TEXT,
    "deeplinkPath" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "snoozeUntil" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Action_clinicId_status_severity_idx" ON "Action"("clinicId", "status", "severity");

-- CreateIndex
CREATE INDEX "Action_clinicId_type_status_idx" ON "Action"("clinicId", "type", "status");

-- CreateIndex
CREATE INDEX "Action_clinicId_assigneeRole_status_idx" ON "Action"("clinicId", "assigneeRole", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Action_clinicId_dedupeKey_key" ON "Action"("clinicId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
