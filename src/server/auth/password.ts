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

// A bcrypt hash of a random throwaway secret, made once per process. Checking
// a password against it costs the same as against a real hash, so "no such
// user" and "wrong password" take the same time (audit SEC-02: the pre-flight
// answered instantly for unknown emails, which enumerated staff logins).
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHash) {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    dummyHash = bcrypt.hash(Buffer.from(bytes).toString("base64"), 10);
  }
  return dummyHash;
}

/**
 * Check `plain` against `hash`, spending one bcrypt comparison even when there
 * is no hash to check against. Returns false whenever `hash` is missing.
 */
export async function verifyPasswordConstantTime(
  plain: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(plain, await getDummyHash());
    return false;
  }
  return bcrypt.compare(plain, hash);
}
