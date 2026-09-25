-- Kiosk device credential (audit SEC-01).
ALTER TABLE "Clinic" ADD COLUMN "kioskTokenHash" TEXT,
ADD COLUMN "kioskTokenIssuedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Clinic_kioskTokenHash_key" ON "Clinic"("kioskTokenHash");
