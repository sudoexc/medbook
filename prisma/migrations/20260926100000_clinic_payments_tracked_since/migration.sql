-- Audit PT-08, final review: patient debt is shown only after an admin turns
-- on «Учёт оплат в CRM». It used to be inferred from the clinic's first PAID
-- payment, so a single payment entered in the CRM turned every later visit
-- paid at the till into «Долг». NULL = off, which is every clinic today.
-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "paymentsTrackedSince" TIMESTAMP(3);
