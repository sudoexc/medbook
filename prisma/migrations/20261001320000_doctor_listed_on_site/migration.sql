-- Audit LD-08: which doctors the public site shows («Наши специалисты», the
-- booking form, /doctors/<id>, the sitemap). Separate from isActive: a doctor
-- who left keeps his history and cannot be deleted, yet must leave the site.
-- DEFAULT true keeps every doctor the site showed before the flag existed.
-- AlterTable
ALTER TABLE "Doctor" ADD COLUMN     "listedOnSite" BOOLEAN NOT NULL DEFAULT true;
