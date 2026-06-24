-- Canned (quick-reply) responses for the Telegram inbox composer
-- (TZ-telegram-section.md Layer 4).
CREATE TABLE "CannedResponse" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "lang" "Lang" NOT NULL DEFAULT 'RU',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CannedResponse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CannedResponse_clinicId_lang_sortOrder_idx" ON "CannedResponse"("clinicId", "lang", "sortOrder");

ALTER TABLE "CannedResponse" ADD CONSTRAINT "CannedResponse_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
