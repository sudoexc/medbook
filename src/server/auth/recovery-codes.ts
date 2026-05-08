/**
 * Phase 17 Wave 2 — Recovery codes for 2FA fallback.
 *
 * Generated as 10 codes of the form `XXXX-XXXX-XXXX` (12 alphanumeric
 * characters split with two dashes for human readability). The plaintext
 * codes are shown to the user EXACTLY ONCE at enrolment / regeneration;
 * we persist only bcrypt hashes in `User.recoveryCodesHash`. Why bcrypt
 * (not a plain hash): the codes are short relative to a password (12
 * chars from a 32-char alphabet ≈ 60 bits of entropy), and a leaked DB
 * shouldn't make brute-forcing them trivial. bcrypt's cost factor buys
 * us seconds-per-guess.
 *
 * Consumption rules (handled in the consume helper):
 *   - At most one match — `timingSafeEqual` prevents short-circuit leaks.
 *   - The matched hash is REMOVED from the array, making each code
 *     single-use.
 *   - We never log the plaintext.
 */
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 chars (no I/O/0/1)
const GROUPS = 3;
const GROUP_LEN = 4;
const COUNT = 10;
const BCRYPT_ROUNDS = 10;

export const RECOVERY_CODE_COUNT = COUNT;

/** Generate a single `XXXX-XXXX-XXXX` code. */
export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let chunk = "";
    for (let i = 0; i < GROUP_LEN; i++) {
      chunk += ALPHABET[randomInt(0, ALPHABET.length)]!;
    }
    groups.push(chunk);
  }
  return groups.join("-");
}

/** Generate a fresh batch of 10 codes. */
export function generateRecoveryCodes(count: number = COUNT): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(generateRecoveryCode());
  return out;
}

export async function hashRecoveryCode(code: string): Promise<string> {
  return bcrypt.hash(normalizeRecoveryCode(code), BCRYPT_ROUNDS);
}

export async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => hashRecoveryCode(c)));
}

/**
 * Normalise user input before hashing / comparing. Authenticator apps
 * can't paste recovery codes anyway, so users will type them; we accept
 * any case, with or without dashes / spaces.
 */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]+/g, "").toUpperCase();
}

export type ConsumeResult =
  | { ok: true; remainingHashes: string[]; remaining: number }
  | { ok: false };

/**
 * Try to match `code` against any of the bcrypt hashes in `hashes`.
 * Returns the new hash array (with the matched hash removed) on success.
 *
 * We compare against EVERY hash even after a hit so total work is
 * constant per attempt — bcrypt.compare is itself constant-time per call,
 * but skipping remaining checks would leak position via timing. Recovery
 * code count is bounded at 10 so this is cheap.
 */
export async function consumeRecoveryCode(
  code: string,
  hashes: readonly string[],
): Promise<ConsumeResult> {
  if (typeof code !== "string" || code.length === 0) return { ok: false };
  const normalised = normalizeRecoveryCode(code);
  // 12 alphanumeric chars after stripping dashes — anything else is invalid
  // input (and not worth a bcrypt round).
  if (!/^[A-Z0-9]{12}$/.test(normalised)) return { ok: false };

  let matchedIndex = -1;
  for (let i = 0; i < hashes.length; i++) {
    // bcrypt.compare returns false safely on a malformed hash too.
    const match = await bcrypt.compare(normalised, hashes[i]!);
    if (match && matchedIndex === -1) matchedIndex = i;
  }
  if (matchedIndex < 0) return { ok: false };
  const remaining = hashes.filter((_, i) => i !== matchedIndex);
  return { ok: true, remainingHashes: remaining, remaining: remaining.length };
}
