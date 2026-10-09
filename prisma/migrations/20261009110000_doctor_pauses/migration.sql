-- «Перерыв» / «Обед» (owner request 09.10.2026): a doctor's pause, shown on
-- his TV instead of the queue. Additive only.
-- CreateTable
CREATE TABLE "DoctorPause" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdById" TEXT,

    CONSTRAINT "DoctorPause_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DoctorPause_doctorId_endedAt_startedAt_idx" ON "DoctorPause"("doctorId", "endedAt", "startedAt");

-- CreateIndex
CREATE INDEX "DoctorPause_clinicId_startedAt_idx" ON "DoctorPause"("clinicId", "startedAt");

-- AddForeignKey
ALTER TABLE "DoctorPause" ADD CONSTRAINT "DoctorPause_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorPause" ADD CONSTRAINT "DoctorPause_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
