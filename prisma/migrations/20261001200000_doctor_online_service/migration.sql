-- Audit MA-08: the service a Mini App booking with this doctor is made for,
-- picked by the admin instead of guessed. Nullable, no backfill: unset keeps
-- a single-service doctor bookable online and asks the admin to choose for
-- a doctor with several services.

-- AlterTable
ALTER TABLE "Doctor" ADD COLUMN     "onlineServiceId" TEXT;

-- AddForeignKey
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_onlineServiceId_fkey" FOREIGN KEY ("onlineServiceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
