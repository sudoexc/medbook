/**
 * The caller's address, as our own proxy saw it (audit SEC-01 / SEC-03).
 *
 * nginx sets `X-Real-IP` from the TCP peer (`$remote_addr`) and APPENDS the
 * peer to `X-Forwarded-For` (`$proxy_add_x_forwarded_for`). The first XFF
 * entry is therefore whatever the client chose to write: a rate limit keyed on
 * it is bypassed by changing a header, and an audit row that records it can be
 * forged. Everything that buckets or records a client IP goes through here.
 *
 * Lives in `lib/` (not in the kiosk module where it was born) so the audit
 * helpers and the auth routes can use it without importing kiosk code;
 * `@/server/kiosk/device` re-exports it for the existing call sites.
 */

type HasHeaders = { headers: { get(name: string): string | null } };

export function realClientIp(request: HasHeaders): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    // The right-most hop is the one our proxy appended.
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  return "unknown";
}

/** Same address for an AuditLog row, where "no address" is stored as null. */
export function clientIpForAudit(request: HasHeaders): string | null {
  const ip = realClientIp(request);
  return ip === "unknown" ? null : ip;
}
