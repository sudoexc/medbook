-- Phase 17 Wave 2 hardening: server-side pinning of in-flight TOTP enrolment.
-- /enroll writes (pendingTotpSecret, pendingTotpExpiresAt); /verify matches
-- against these columns instead of trusting the client. TTL is enforced by
-- the application layer (10 min) but we keep both columns nullable so the
-- normal post-verify state has them cleared.

ALTER TABLE "User"
  ADD COLUMN "pendingTotpSecret"    TEXT,
  ADD COLUMN "pendingTotpExpiresAt" TIMESTAMP(3);
