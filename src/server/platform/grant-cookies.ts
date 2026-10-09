/**
 * The two cookies of a SUPER_ADMIN's clinic visit: the HMAC-signed
 * `admin_clinic_override` (which clinic) and `admin_grant_id` (which
 * ImpersonationGrant row vouches for it). Both live exactly as long as the
 * grant's lease: entering a clinic sets them, «Продлить» re-sets them with
 * the new end (owner request 09.10.2026), «Выйти» clears them.
 *
 * Shared by POST /api/platform/session/switch-clinic and
 * POST /api/platform/session/extend so the two cannot drift apart. Sign-out
 * clears the same pair through `next/headers` (src/lib/auth.ts).
 */
import {
  OVERRIDE_COOKIE_NAME,
  signClinicOverride,
} from "@/server/platform/clinic-override";
import { GRANT_COOKIE_NAME } from "@/server/platform/impersonation";

/** The grant id from the request's `Cookie:` header, if any. */
export function readGrantCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const needle = `${GRANT_COOKIE_NAME}=`;
  for (const pair of header.split(";")) {
    const trimmed = pair.trim();
    if (trimmed.startsWith(needle)) return trimmed.slice(needle.length) || null;
  }
  return null;
}

export function cookieHeader(
  name: string,
  value: string,
  maxAgeSeconds: number,
): string {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    process.env.NODE_ENV === "production" ? "Secure" : "",
    `Max-Age=${maxAgeSeconds}`,
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * `Set-Cookie` headers for a live lease. The override must NOT outlive the
 * grant: auth.ts treats a present override with an absent grant as no
 * impersonation (fail closed), and a longer-lived override once kept a visit
 * alive for up to 12h past the lease.
 */
export function leaseCookieHeaders(input: {
  clinicId: string;
  grantId: string;
  expiresAt: Date;
  now?: number;
}): Headers {
  const leaseSeconds = Math.max(
    60,
    Math.round((input.expiresAt.getTime() - (input.now ?? Date.now())) / 1000),
  );
  const headers = new Headers();
  headers.append(
    "set-cookie",
    cookieHeader(OVERRIDE_COOKIE_NAME, signClinicOverride(input.clinicId), leaseSeconds),
  );
  headers.append(
    "set-cookie",
    cookieHeader(GRANT_COOKIE_NAME, input.grantId, leaseSeconds),
  );
  return headers;
}

/** `Set-Cookie` headers that drop both cookies. */
export function clearLeaseCookieHeaders(): Headers {
  const headers = new Headers();
  headers.append("set-cookie", cookieHeader(OVERRIDE_COOKIE_NAME, "", 0));
  headers.append("set-cookie", cookieHeader(GRANT_COOKIE_NAME, "", 0));
  return headers;
}
