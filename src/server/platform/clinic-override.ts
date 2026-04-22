/**
 * SUPER_ADMIN "impersonate clinic" cookie.
 *
 * Mechanism: when a SUPER_ADMIN picks a clinic in the ClinicSwitcher, we set a
 * signed cookie `admin_clinic_override` whose value is `{clinicId}:{hmac}`
 * using HMAC-SHA256 over the clinicId + `APP_SECRET`. The NextAuth `jwt`
 * callback reads this cookie on every token refresh and, if the actor is a
 * SUPER_ADMIN, swaps their `clinicId` claim for the selected one.
 *
 * This mechanism was chosen because:
 *   1. It keeps the JWT signing flow intact — no reimplementation of session
 *      issuance on the client.
 *   2. It makes the override cheap to revoke: clear the cookie.
 *   3. It is cross-tab safe: every request reads the same cookie.
 *   4. It does not persist on the database — nothing to garbage-collect.
 *
 * The HMAC prevents a client from forging an override that selects a clinic
 * that they are not SUPER_ADMIN over (the cookie is still validated against
 * the session role in `auth.ts` — a non-SUPER_ADMIN cookie is ignored).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const OVERRIDE_COOKIE_NAME = "admin_clinic_override";
const SIGNING_SALT = "admin-clinic-override-v1";

function readSecret(): string {
  const s = process.env.APP_SECRET ?? process.env.AUTH_SECRET;
  if (!s) throw new Error("APP_SECRET/AUTH_SECRET not configured");
  return s;
}

function hmac(clinicId: string): string {
  return createHmac("sha256", readSecret() + ":" + SIGNING_SALT)
    .update(clinicId)
    .digest("base64url");
}

/** Produce the cookie value for a clinic selection. */
export function signClinicOverride(clinicId: string): string {
  return `${clinicId}.${hmac(clinicId)}`;
}

/**
 * Read a cookie value and return the signed clinicId, or `null` if the
 * cookie is missing / malformed / signature invalid.
 */
export function verifyClinicOverride(cookieValue: string | null | undefined): string | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;
  const [clinicId, sig] = parts as [string, string];
  if (!clinicId || !sig) return null;
  const expected = hmac(clinicId);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  try {
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return clinicId;
}

/**
 * Parse a `Cookie:` request header and return the override clinicId, if any.
 * Used by server-side code that doesn't have a `next/headers` cookies() handle.
 */
export function readOverrideFromCookieHeader(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const needle = `${OVERRIDE_COOKIE_NAME}=`;
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (trimmed.startsWith(needle)) {
      return verifyClinicOverride(trimmed.slice(needle.length));
    }
  }
  return null;
}
