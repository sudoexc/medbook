/**
 * AES-256-GCM symmetric encryption for provider-connection secrets and any
 * other clinic-level credential that must be stored at rest in Postgres.
 *
 * Format: `v1:{iv_b64}:{authTag_b64}:{ciphertext_b64}`
 *   - `iv` is a 12-byte random nonce (recommended length for GCM).
 *   - `authTag` is 16 bytes, verified on decrypt — any tampered ciphertext
 *     will throw inside `crypto.decipher.final()`.
 *   - Payload is UTF-8 text encoded to base64.
 *
 * Key derivation: `scryptSync(APP_SECRET, "medbook-secret-v1", 32)`.
 * `APP_SECRET` is the primary env var; if absent we fall back to
 * `AUTH_SECRET` (already present in `.env` and used by NextAuth) so existing
 * deployments don't need two secrets. Tests and local dev may set a fresh
 * `APP_SECRET`; CI injects its own.
 *
 * Rationale for rolling our own format (rather than leaning on a KMS):
 *   - Node's `crypto` is in the stdlib — no extra npm dep.
 *   - A single-tenant clinic installation doesn't need external KMS.
 *   - The version tag `v1:` lets a future migration add rotation or move
 *     to KMS-envelope encryption without breaking stored values.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const VERSION = "v1";
const IV_LENGTH = 12; // 96-bit nonce — GCM recommended
const KEY_LENGTH = 32; // 256-bit key
const SALT = "medbook-secret-v1";

function readAppSecret(): string {
  const primary = process.env.APP_SECRET;
  if (primary && primary.length > 0) return primary;
  const fallback = process.env.AUTH_SECRET;
  if (fallback && fallback.length > 0) return fallback;
  throw new Error(
    "CryptoConfigError: APP_SECRET (or AUTH_SECRET fallback) is not set",
  );
}

/**
 * Derive a 32-byte key from the app secret via scrypt. Cached per-process
 * because key derivation is deliberately slow. We re-read the env var when
 * the derived key is missing so tests can swap secrets between cases via
 * `__resetCryptoCacheForTests`.
 */
let cachedKey: { secret: string; key: Buffer } | null = null;
function deriveKey(): Buffer {
  const secret = readAppSecret();
  if (cachedKey && cachedKey.secret === secret) {
    return cachedKey.key;
  }
  const key = scryptSync(secret, SALT, KEY_LENGTH);
  cachedKey = { secret, key };
  return key;
}

/** Testing only — drop the cached derived key so a fresh env var takes effect. */
export function __resetCryptoCacheForTests(): void {
  cachedKey = null;
}

/**
 * Encrypt a UTF-8 string. Returns a string in the form
 * `v1:{iv}:{tag}:{ciphertext}` — safe for JSON columns and env vars.
 */
export function encrypt(plaintext: string): string {
  if (typeof plaintext !== "string") {
    throw new TypeError("encrypt: plaintext must be a string");
  }
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a ciphertext produced by `encrypt`. Throws on a tampered payload,
 * mismatched key, or an unknown version tag.
 */
export function decrypt(ciphertext: string): string {
  if (typeof ciphertext !== "string" || ciphertext.length === 0) {
    throw new Error("decrypt: ciphertext must be a non-empty string");
  }
  const parts = ciphertext.split(":");
  if (parts.length !== 4) {
    throw new Error("decrypt: malformed ciphertext (expected 4 segments)");
  }
  const [version, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  if (version !== VERSION) {
    throw new Error(`decrypt: unsupported version tag: ${version}`);
  }
  const key = deriveKey();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  if (iv.length !== IV_LENGTH) {
    throw new Error(`decrypt: bad IV length ${iv.length}`);
  }
  if (tag.length !== 16) {
    throw new Error(`decrypt: bad authTag length ${tag.length}`);
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/**
 * Mask a secret for UI display: shows the last 4 characters (or fewer if the
 * secret is short) prefixed by bullets. Safe for public responses — never
 * returns a portion of the secret that could be used to probe.
 */
export function maskSecret(plaintext: string | null | undefined): string {
  if (!plaintext) return "";
  const s = plaintext;
  if (s.length <= 4) return "••••";
  return "••••" + s.slice(-4);
}

/**
 * Returns true iff the two strings are byte-identical. Constant-time —
 * appropriate for comparing MACs or short secrets.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
