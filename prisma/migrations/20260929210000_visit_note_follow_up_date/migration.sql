-- Clinic request 29.09.2026: the control visit can be an exact day, not only
-- «через N дней». A Tashkent calendar day, so DATE. Nullable: every existing
-- note keeps its plan in "followUpDays" and reads exactly as before.
-- AlterTable
ALTER TABLE "VisitNote" ADD COLUMN     "followUpDate" DATE;
