-- Short-lived invite-link rows minted from the CRM patient card so a
-- not-yet-linked patient can land in the clinic Telegram bot via
-- t.me/<bot>?start=<token>. The bot webhook consumes the token on
-- /start, stamping Patient.telegramId + telegramUsername.
CREATE TABLE "TelegramInviteToken" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedTelegramId" TEXT,

    CONSTRAINT "TelegramInviteToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramInviteToken_token_key" ON "TelegramInviteToken"("token");
CREATE INDEX "TelegramInviteToken_clinicId_idx" ON "TelegramInviteToken"("clinicId");
CREATE INDEX "TelegramInviteToken_patientId_idx" ON "TelegramInviteToken"("patientId");
CREATE INDEX "TelegramInviteToken_expiresAt_idx" ON "TelegramInviteToken"("expiresAt");

ALTER TABLE "TelegramInviteToken"
    ADD CONSTRAINT "TelegramInviteToken_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TelegramInviteToken"
    ADD CONSTRAINT "TelegramInviteToken_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TelegramInviteToken"
    ADD CONSTRAINT "TelegramInviteToken_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
