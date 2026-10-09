-- Print agents and jobs (owner request 09.10.2026): tickets printed straight
-- to the network receipt printer from the iPad and the desk. Additive only.
-- CreateTable
CREATE TABLE "PrintAgent" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Ресепшн',
    "tokenHash" TEXT NOT NULL,
    "printerHost" TEXT NOT NULL,
    "printerPort" INTEGER NOT NULL DEFAULT 9100,
    "codePage" INTEGER NOT NULL DEFAULT 17,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "data" TEXT NOT NULL,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrintAgent_tokenHash_key" ON "PrintAgent"("tokenHash");

-- CreateIndex
CREATE INDEX "PrintAgent_clinicId_active_idx" ON "PrintAgent"("clinicId", "active");

-- CreateIndex
CREATE INDEX "PrintJob_agentId_status_createdAt_idx" ON "PrintJob"("agentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PrintJob_clinicId_createdAt_idx" ON "PrintJob"("clinicId", "createdAt");

-- AddForeignKey
ALTER TABLE "PrintAgent" ADD CONSTRAINT "PrintAgent_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "PrintAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
