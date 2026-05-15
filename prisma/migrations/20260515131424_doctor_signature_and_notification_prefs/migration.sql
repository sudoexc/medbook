-- Add doctor signature image url
ALTER TABLE "Doctor" ADD COLUMN "signatureUrl" TEXT;

-- Per-doctor notification channel preferences
CREATE TABLE "DoctorNotificationPref" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "appointmentCreated_inApp" BOOLEAN NOT NULL DEFAULT true,
    "appointmentCreated_email" BOOLEAN NOT NULL DEFAULT false,
    "appointmentCreated_telegram" BOOLEAN NOT NULL DEFAULT true,
    "messageNew_inApp" BOOLEAN NOT NULL DEFAULT true,
    "messageNew_email" BOOLEAN NOT NULL DEFAULT false,
    "messageNew_telegram" BOOLEAN NOT NULL DEFAULT true,
    "labResultReceived_inApp" BOOLEAN NOT NULL DEFAULT true,
    "labResultReceived_email" BOOLEAN NOT NULL DEFAULT true,
    "labResultReceived_telegram" BOOLEAN NOT NULL DEFAULT false,
    "reminderDue_inApp" BOOLEAN NOT NULL DEFAULT true,
    "reminderDue_email" BOOLEAN NOT NULL DEFAULT false,
    "reminderDue_telegram" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorNotificationPref_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DoctorNotificationPref_userId_key" ON "DoctorNotificationPref"("userId");

ALTER TABLE "DoctorNotificationPref" ADD CONSTRAINT "DoctorNotificationPref_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
