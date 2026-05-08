-- Phase 17 Wave 2 — Session security & per-clinic 2FA enforcement.
--
-- Schema deltas:
--   Clinic.require2faForAll       — when true, every staff role in the
--     clinic must enrol TOTP, not just ADMIN/SUPER_ADMIN. Plan-gated to
--     Pro / Enterprise (basic plans cannot flip this on).
--   Clinic.sessionIdleTimeoutMinutes — soft idle cutoff for the proxy.
--     Bound to [5, 240]. Default 30 mirrors the spec.
--
--   UserSession — one row per active CRM session. Used to enforce the
--     concurrent-session-per-user limit (we kick the prior session on a
--     fresh login). The middleware/proxy rejects requests whose
--     userSessionId cookie does not match the live row, allowing cookie
--     theft / session-hijack mitigations to be added later. tokenHash is
--     a sha256 of the long random session token; we never store the
--     token itself. lastActivityAt is bumped on every authenticated hit
--     so the idle-timeout check is a single column read.

-- Clinic — Wave 2 columns.
ALTER TABLE "Clinic"
    ADD COLUMN "require2faForAll"          BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "sessionIdleTimeoutMinutes" INTEGER NOT NULL DEFAULT 30;

-- UserSession — concurrent-session enforcement table.
CREATE TABLE "UserSession" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "clinicId"       TEXT,
    "tokenHash"      TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent"      TEXT,
    "ip"             TEXT,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");
CREATE INDEX "UserSession_userId_idx"            ON "UserSession"("userId");
CREATE INDEX "UserSession_userId_createdAt_idx"  ON "UserSession"("userId", "createdAt");

ALTER TABLE "UserSession"
    ADD CONSTRAINT "UserSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSession"
    ADD CONSTRAINT "UserSession_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
