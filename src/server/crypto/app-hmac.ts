/**
 * Purpose-scoped HMAC over the app secret, for the small capability tokens
 * the public surfaces hand out (audit INF-10, CD-08, MA-07): the queue ticket
 * link, the anonymous board row key, the document upload receipt, the Mini
 * App file / calendar / event-stream links.
 *
 * Same construction as the clinic-override and 2FA-pending cookies (HMAC-SHA256
 * keyed by `APP_SECRET`, falling back to `AUTH_SECRET`, with a per-purpose
 * salt), so a signature minted for one purpose never verifies for another:
 * a board row key cannot be replayed as a ticket token even though both are
 * computed over the same appointment id.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function readSecret(): string {
  const s = process.env.APP_SECRET || process.env.AUTH_SECRET;
  if (!s) throw new Error("APP_SECRET/AUTH_SECRET not configured");
  return s;
}

/**
 * base64url HMAC of `message` under `purpose`, truncated to `bytes` bytes.
 * 16 bytes (128 bits) is far past online guessing and keeps a QR small.
 */
export function appHmac(purpose: string, message: string, bytes = 16): string {
  return createHmac("sha256", `${readSecret()}:${purpose}`)
    .update(message)
    .digest()
    .subarray(0, bytes)
    .toString("base64url");
}

/** Constant-time check of a signature produced by `appHmac`. */
export function appHmacMatches(
  purpose: string,
  message: string,
  signature: string,
  bytes = 16,
): boolean {
  const expected = Buffer.from(appHmac(purpose, message, bytes));
  const given = Buffer.from(signature);
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}
