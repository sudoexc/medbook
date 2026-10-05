-- Per-account start page (owner request 05.10.2026): the clinic's iPad
-- reception account opens straight into /crm/reception/tablet. Additive and
-- nullable: every existing account keeps NULL, which means the role's usual
-- home, so nothing changes for anyone until an admin (or
-- scripts/set-start-page.ts) sets it. Adding a nullable column without a
-- default is a catalog-only change in Postgres, no table rewrite.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "startPage" TEXT;
