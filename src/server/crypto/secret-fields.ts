/**
 * Encryption boundary for authentication-critical secrets stored on
 * `User` / `Clinic` rows:
 *
 *   - `User.totpSecret` / `User.pendingTotpSecret` — the 2FA seed. A DB dump
 *     with plaintext seeds lets an attacker mint valid codes for any user,
 *     i.e. the second factor stops being a factor.
 *   - `Clinic.tgBotToken` — doubles as the HMAC key that authenticates the
 *     entire patient surface (Mini App `initData` verification), so at-rest
 *     leakage means the ability to forge requests as any patient.
 *
 * Why the `crypto/secrets.ts` cipher (APP_SECRET-derived) and not the PII
 * `field-cipher`: these are credentials, exactly the class `secrets.ts` was
 * built for (ProviderConnection secrets use it already). Keeping credentials
 * under a different key than medical PII also means a leaked
 * FIELD_ENCRYPTION_KEY alone still doesn't expose auth material.
 *
 * Compatibility contract (production has plaintext rows written before this
 * boundary existed):
 *   - WRITE always produces ciphertext. An already-encrypted input is passed
 *     through untouched so promote/copy paths can never double-encrypt.
 *   - READ tolerates legacy plaintext by checking for the `v<n>:` envelope
 *     (`isEncryptedSecret`) — plaintext flows through unchanged until
 *     `scripts/encrypt-auth-secrets.ts` backfills it. Decrypt failures throw:
 *     a tampered or wrong-key ciphertext must surface loudly, not fail open
 *     into "secret doesn't match".
 *
 * Call sites must go through these helpers instead of touching the columns
 * directly, so the fallback logic lives in exactly one place.
 */
import { decrypt, encrypt, isEncryptedSecret } from "./secrets";

function encryptIfPlain(value: string | null): string | null {
  if (value === null || value === undefined) return null;
  // Empty string means "explicitly cleared" in the settings routes — there is
  // nothing secret about absence, so don't burn an IV on it.
  if (value === "") return "";
  if (isEncryptedSecret(value)) return value;
  return encrypt(value);
}

function decryptIfEncrypted(value: string | null): string | null {
  if (value === null || value === undefined) return null;
  if (!isEncryptedSecret(value)) return value; // legacy plaintext row
  return decrypt(value);
}

/**
 * Prepare a TOTP secret (real or pending) for persistence. Overloaded so a
 * call site that has a guaranteed-string plaintext keeps a `string` return
 * type without non-null assertions.
 */
export function writeTotpSecret(plaintext: string): string;
export function writeTotpSecret(plaintext: string | null): string | null;
export function writeTotpSecret(plaintext: string | null): string | null {
  return encryptIfPlain(plaintext);
}

/** Decrypt a stored TOTP secret; legacy plaintext passes through unchanged. */
export function readTotpSecret(stored: string): string;
export function readTotpSecret(stored: string | null | undefined): string | null;
export function readTotpSecret(stored: string | null | undefined): string | null {
  return decryptIfEncrypted(stored ?? null);
}

/** Prepare a clinic bot token for persistence (always ciphertext). */
export function writeTgBotToken(plaintext: string): string;
export function writeTgBotToken(plaintext: string | null): string | null;
export function writeTgBotToken(plaintext: string | null): string | null {
  return encryptIfPlain(plaintext);
}

/** Decrypt a stored bot token; legacy plaintext passes through unchanged. */
export function readTgBotToken(stored: string): string;
export function readTgBotToken(stored: string | null | undefined): string | null;
export function readTgBotToken(stored: string | null | undefined): string | null {
  return decryptIfEncrypted(stored ?? null);
}
