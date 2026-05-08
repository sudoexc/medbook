/**
 * Phase 17 Wave 2 — "TOTP pending" interim cookie.
 *
 * After a successful password check, if the user has TOTP enrolled we
 * issue a short-lived signed token (cookie) that proves "this user has
 * already cleared the password challenge" and let them through to
 * /login/2fa. The cookie's only payload is the userId + an issued-at
 * timestamp; everything else is re-derived from the User row at verify
 * time so a stolen / replayed cookie cannot upgrade a different user.
 *
 *   - HMAC-SHA256, base64url-encoded, scoped by `2fa-pending-v1` salt.
 *   - 5 minute TTL — the user has to type their TOTP within that window
 *     or restart the login flow.
 *   - Single value, not a JWT, because we don't need claim flexibility
 *     and we already have the same HMAC mechanism in clinic-override.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const PENDING_COOKIE_NAME = "tfa_pending";
const SIGNING_SALT = "2fa-pending-v1";
const TTL_MS = 5 * 60 * 1000;

function readSecret(): string {
  const s = process.env.APP_SECRET ?? process.env.AUTH_SECRET;
  if (!s) throw new Error("APP_SECRET/AUTH_SECRET not configured");
  return s;
}

function hmac(payload: string): string {
  return createHmac("sha256", readSecret() + ":" + SIGNING_SALT)
    .update(payload)
    .digest("base64url");
}

export type PendingPayload = {
  userId: string;
  issuedAt: number; // epoch ms
};

export function signPending(userId: string, now: Date = new Date()): string {
  const payload = `${userId}.${now.getTime()}`;
  return `${payload}.${hmac(payload)}`;
}

export function verifyPending(
  cookieValue: string | null | undefined,
  now: Date = new Date(),
): PendingPayload | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 3) return null;
  const [userId, issuedRaw, sig] = parts as [string, string, string];
  if (!userId || !issuedRaw || !sig) return null;
  const issuedAt = Number(issuedRaw);
  if (!Number.isFinite(issuedAt)) return null;
  if (now.getTime() - issuedAt > TTL_MS) return null;
  if (issuedAt > now.getTime() + 60_000) return null; // future-dated → reject

  const payload = `${userId}.${issuedRaw}`;
  const a = Buffer.from(sig);
  const b = Buffer.from(hmac(payload));
  if (a.length !== b.length) return null;
  try {
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return { userId, issuedAt };
}

export const __INTERNALS__ = { TTL_MS };
