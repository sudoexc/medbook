/**
 * Helpers for server-side password generation + hashing.
 *
 * - `generateTempPassword` returns a human-friendly one-shot password used by
 *   onboarding flows (clinic creation, user invite, password reset). The
 *   alphabet excludes ambiguous chars (0/O, 1/l/I) so receptionists can read
 *   it over the phone or copy from a screenshot without errors.
 * - `hashPassword` wraps bcryptjs at 10 rounds — the cost factor we already
 *   use elsewhere in the codebase (see /api/crm/users/route.ts).
 */
import bcrypt from "bcryptjs";

const SAFE_ALPHABET =
  "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateTempPassword(length = 12): string {
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += SAFE_ALPHABET.charAt(arr[i]! % SAFE_ALPHABET.length);
  }
  return out;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}
