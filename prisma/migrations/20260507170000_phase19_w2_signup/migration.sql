-- Phase 19 Wave 2 — self-service signup tokens.
--
-- One row per `/signup` form submission. The visitor receives a
-- url-safe random `token` by email; clicking the confirm link consumes the
-- row, provisions a Clinic + ADMIN user + TRIAL Subscription on `basic`
-- and applies the chosen onboarding playbook.
--
-- The row is intentionally NOT FK'd to Clinic — it outlives the clinic for
-- audit purposes and a future GC sweeps consumed/expired rows independently.
-- `consumedClinicId` is denormalised so we can correlate without an FK.

CREATE TABLE "ClinicSignupToken" (
    "id"               TEXT         NOT NULL,
    "email"            TEXT         NOT NULL,
    "clinicName"       TEXT         NOT NULL,
    "phone"            TEXT,
    "planSlug"         TEXT         NOT NULL DEFAULT 'basic',
    "playbookSlug"     TEXT,
    "preferredLocale"  TEXT         NOT NULL DEFAULT 'ru',
    "token"            TEXT         NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"        TIMESTAMP(3) NOT NULL,
    "consumedAt"       TIMESTAMP(3),
    "consumedClinicId" TEXT,

    CONSTRAINT "ClinicSignupToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicSignupToken_token_key" ON "ClinicSignupToken"("token");
CREATE INDEX "ClinicSignupToken_email_idx" ON "ClinicSignupToken"("email");
CREATE INDEX "ClinicSignupToken_expiresAt_idx" ON "ClinicSignupToken"("expiresAt");
