-- Addresses staff accounts completed a sign-in from (audit SEC-02, login
-- throttle review): exempts them from the shared failure buckets.
-- CreateTable
CREATE TABLE "StaffLoginSource" (
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffLoginSource_pkey" PRIMARY KEY ("userId","source")
);

-- AddForeignKey
ALTER TABLE "StaffLoginSource" ADD CONSTRAINT "StaffLoginSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

