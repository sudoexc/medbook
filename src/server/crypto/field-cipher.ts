/**
 * Phase 17 Wave 4 — App-level encryption-at-rest for designated PII fields.
 *
 * Format: `<version>:<iv_b64>:<tag_b64>:<ct_b64>` (e.g. `v1:AAAA…:BBBB…:CCCC…`).
 * AES-256-GCM, 96-bit random IV per call (GCM-recommended), 128-bit auth tag.
 *
 * Why GCM (not CBC): authenticated cipher → tag mismatch surfaces tampering.
 * Why per-call random IV: GCM IVs MUST never repeat under the same key —
 *   deterministic IVs would let an attacker recover plaintext deltas.
 * Why a versioned prefix: lets us run a key-rotation script without breaking
 *   reads of rows that haven't been re-encrypted yet, and lets us upgrade the
 *   algorithm later (`v2:` could mean a different cipher entirely).
 *
 * We chose **app-level** over `pgcrypto`-in-queries because every read would
 * otherwise need a `pgp_sym_decrypt` wrapper threaded through Prisma's
 * generated SQL — painful with the custom-output Prisma client and the
 * multi-tenant runtime. The data is still secured: the key never lives in
 * the DB, a Postgres dump captured without `FIELD_ENCRYPTION_KEY` is useless,
 * and there is no SELECT-time function-call overhead.
 *
 * Key resolution order:
 *   1. `FIELD_ENCRYPTION_KEY_V<n>` — versioned keys (highest n = active).
 *   2. `FIELD_ENCRYPTION_KEY` — legacy single-key fallback, treated as v1.
 *   3. In `NODE_ENV !== 'production'`: a deterministic dev key (warned once).
 *      Production refuses to start without a real key — fail closed.
 *
 * Encryption ALWAYS uses the active version. Decryption tries the embedded
 * version's key. To rotate: set `FIELD_ENCRYPTION_KEY_V2`, restart workers
 * (now writes use v2, reads still understand v1), run the rotation script
 * to re-encrypt v1 rows under v2, then drop `FIELD_ENCRYPTION_KEY_V1`.
 *
 * See `docs/runbooks/encryption-key-rotation.md`.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const TAG_LENGTH = 16;

export type KeyVersion = `v${number}`;

/**
 * Resolved set of keys. `active` is the version used for new writes; `byVersion`
 * is consulted on decrypt by reading the prefix from the ciphertext.
 */
type KeySet = {
  active: KeyVersion;
  byVersion: Map<KeyVersion, Buffer>;
  /** True iff the key was synthesised from the dev fallback. */
  isDevFallback: boolean;
};

let cachedKeySet: KeySet | null = null;
let testOverride: KeySet | null = null;
let devWarningShown = false;

/**
 * Synthesise a 32-byte key from a deterministic dev string. This is ONLY used
 * when no key env var is set AND we're not in production. Production refuses
 * to boot without a real key — see `resolveKeySet`.
 */
function deriveDevKey(): Buffer {
  // Plain SHA-256 over a fixed string. Not for production — anyone reading
  // this source can derive the key. The point is just to keep dev/test
  // round-trips working without env-var ceremony.
  return createHash("sha256")
    .update("dev-only-do-not-use-in-prod")
    .digest();
}

function decodeKey(envValue: string, source: string): Buffer {
  const buf = Buffer.from(envValue, "base64");
  if (buf.length !== KEY_LENGTH) {
    throw new Error(
      `FieldCipherConfigError: ${source} must decode to ${KEY_LENGTH} bytes (got ${buf.length}). Use \`openssl rand -base64 32\`.`,
    );
  }
  return buf;
}

function resolveKeySet(): KeySet {
  if (testOverride) return testOverride;
  if (cachedKeySet) return cachedKeySet;

  const byVersion = new Map<KeyVersion, Buffer>();

  // Versioned keys first. Walk the env so v3 / v4 work without code changes.
  for (const [name, value] of Object.entries(process.env)) {
    const m = name.match(/^FIELD_ENCRYPTION_KEY_V(\d+)$/);
    if (!m || !value) continue;
    const version = `v${m[1]}` as KeyVersion;
    byVersion.set(version, decodeKey(value, name));
  }

  // Legacy un-versioned fallback maps to v1.
  if (!byVersion.has("v1") && process.env.FIELD_ENCRYPTION_KEY) {
    byVersion.set(
      "v1",
      decodeKey(process.env.FIELD_ENCRYPTION_KEY, "FIELD_ENCRYPTION_KEY"),
    );
  }

  if (byVersion.size === 0) {
    if (process.env.NODE_ENV === "production") {
      // Fail closed — never silently encrypt under a known-public dev key
      // in prod. The deploy is missing FIELD_ENCRYPTION_KEY.
      throw new Error(
        "FieldCipherConfigError: FIELD_ENCRYPTION_KEY (or FIELD_ENCRYPTION_KEY_V<n>) is not set. Refusing to boot in production.",
      );
    }
    if (!devWarningShown) {
      devWarningShown = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[field-cipher] WARNING: FIELD_ENCRYPTION_KEY is not set — using a deterministic dev key. Do NOT use this in production.",
      );
    }
    byVersion.set("v1", deriveDevKey());
    cachedKeySet = {
      active: "v1",
      byVersion,
      isDevFallback: true,
    };
    return cachedKeySet;
  }

  // Active = highest numeric suffix.
  let activeNum = 0;
  for (const v of byVersion.keys()) {
    const n = parseInt(v.slice(1), 10);
    if (n > activeNum) activeNum = n;
  }

  cachedKeySet = {
    active: `v${activeNum}` as KeyVersion,
    byVersion,
    isDevFallback: false,
  };
  return cachedKeySet;
}

/** Active key version used for new writes. */
export function getActiveKeyVersion(): KeyVersion {
  return resolveKeySet().active;
}

/** All known key versions — used by the health-check route and rotation. */
export function getKnownKeyVersions(): KeyVersion[] {
  return [...resolveKeySet().byVersion.keys()].sort((a, b) => {
    return parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10);
  });
}

/**
 * Encrypt a UTF-8 string under the active key. `null` is rejected — call sites
 * should skip encryption when the value is null (the boundary helpers handle
 * that already).
 */
export function encryptField(plaintext: string): string {
  if (typeof plaintext !== "string") {
    throw new TypeError("encryptField: plaintext must be a string");
  }
  const set = resolveKeySet();
  const key = set.byVersion.get(set.active)!;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    set.active,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a value previously produced by `encryptField`. Null-safe — `null`
 * passes through. Throws clearly on tag mismatch (tampering, wrong key) or an
 * unknown version prefix. Callers that need to surface the failure as an
 * audit event should catch and emit `ENCRYPTION_DECRYPT_FAILED`.
 */
export function decryptField(value: string | null): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("decryptField: ciphertext must be a non-empty string");
  }
  const parts = value.split(":");
  if (parts.length !== 4) {
    throw new Error("decryptField: malformed ciphertext (expected 4 segments)");
  }
  const [version, ivB64, tagB64, ctB64] = parts as [
    string,
    string,
    string,
    string,
  ];
  if (!/^v\d+$/.test(version)) {
    throw new Error(`decryptField: unsupported version tag: ${version}`);
  }
  const set = resolveKeySet();
  const key = set.byVersion.get(version as KeyVersion);
  if (!key) {
    throw new Error(
      `decryptField: no key configured for version ${version} (active=${set.active})`,
    );
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  if (iv.length !== IV_LENGTH) {
    throw new Error(`decryptField: bad IV length ${iv.length}`);
  }
  if (tag.length !== TAG_LENGTH) {
    throw new Error(`decryptField: bad authTag length ${tag.length}`);
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/**
 * True iff the value carries our `v<n>:` prefix. Used by the backfill /
 * rotation scripts to skip rows that are already encrypted, and by the health
 * route to slice "rows by encryption version".
 */
export function isEncryptedField(value: string | null): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== "string" || value.length < 4) return false;
  const colon = value.indexOf(":");
  if (colon < 2) return false;
  return /^v\d+$/.test(value.slice(0, colon));
}

/**
 * Return the version prefix of an encrypted value, or `null` for plaintext /
 * malformed input. Used by the rotation script to drive "find rows not under
 * the active version".
 */
export function readVersionPrefix(value: string | null): KeyVersion | null {
  if (!isEncryptedField(value)) return null;
  const colon = (value as string).indexOf(":");
  return (value as string).slice(0, colon) as KeyVersion;
}

/**
 * Test-only key override. Pass `null` to clear. Use this in vitest beforeEach
 * to swap key sets without depending on env-var resolution order.
 */
export function __setKeyForTests(
  override: { active: KeyVersion; keys: Record<string, Buffer> } | null,
): void {
  if (!override) {
    testOverride = null;
    cachedKeySet = null;
    devWarningShown = false;
    return;
  }
  const map = new Map<KeyVersion, Buffer>();
  for (const [k, v] of Object.entries(override.keys)) {
    map.set(k as KeyVersion, v);
  }
  testOverride = {
    active: override.active,
    byVersion: map,
    isDevFallback: false,
  };
}

/**
 * Test-only — drop the cached key set so the next call reads env vars fresh.
 */
export function __resetKeyCacheForTests(): void {
  cachedKeySet = null;
  testOverride = null;
  devWarningShown = false;
}
