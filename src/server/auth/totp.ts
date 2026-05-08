/**
 * Phase 17 Wave 2 — RFC 6238 TOTP helpers.
 *
 * We implement TOTP from scratch using node:crypto rather than pulling in
 * `otplib` because (a) the algorithm is short and well-defined, (b) the
 * library would land another dep, and (c) we need exact control over the
 * verification window and constant-time compare.
 *
 *   - SHA-1 HMAC, 6-digit, 30-second step (Google-Authenticator standard).
 *   - Base32 encode/decode for the secret (RFC 4648, no padding required by
 *     authenticator apps but we accept it on input).
 *   - Verification window of ±1 step (so a code is accepted for ~90s
 *     including the current step). Larger windows make replay easier; ±1
 *     is the conservative default and matches the one Google Authenticator
 *     itself tolerates on the server side.
 *
 * The `otpauth://` URI is built per the de-facto spec
 * (github.com/google/google-authenticator/wiki/Key-Uri-Format) so any
 * mainstream TOTP authenticator scans it cleanly.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STEP_SECONDS = 30;
const DIGITS = 6;
// ±1 window: previous step + current step + next step.
//
// Why ±1 specifically: clock drift between a phone and a server is almost
// always under 30 seconds, and accepting a wider window meaningfully
// degrades replay protection. Authenticator apps that drift by minutes are
// already broken; we don't bend the spec to compensate.
const DEFAULT_WINDOW = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// ---------------------------------------------------------------------------
// Base32 encode / decode (RFC 4648, no padding on output)
// ---------------------------------------------------------------------------

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]!;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i]!;
    const idx = BASE32_ALPHABET.indexOf(c);
    if (idx < 0) {
      throw new Error("base32: invalid character");
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---------------------------------------------------------------------------
// Secret generation
// ---------------------------------------------------------------------------

/** 20 bytes (160 bits) per RFC 4226 §4 recommendation, base32-encoded. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

function counterBuffer(counter: number): Buffer {
  const buf = Buffer.alloc(8);
  // Counter is a 64-bit big-endian uint. JS numbers are safe up to 2^53,
  // and the Unix-time / 30 counter fits comfortably; high 4 bytes stay 0.
  buf.writeUInt32BE(0, 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  return buf;
}

export function generateTotpCode(
  secretBase32: string,
  atUnixSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(atUnixSeconds / STEP_SECONDS);
  const hmac = createHmac("sha1", key).update(counterBuffer(counter)).digest();
  // Dynamic truncation per RFC 4226 §5.3.
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  const mod = 10 ** DIGITS;
  return String(code % mod).padStart(DIGITS, "0");
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type VerifyTotpOptions = {
  /** Steps of tolerance on either side. Default 1 (±30s). */
  window?: number;
  /** Override clock for tests. */
  atUnixSeconds?: number;
};

/**
 * Constant-time, windowed verification. Returns true iff `code` matches
 * any TOTP within ±window steps of `atUnixSeconds`.
 *
 * Malformed input (non-digit characters, wrong length, empty string,
 * undecodable secret) returns false rather than throwing — callers
 * never have to wrap this in try/catch.
 */
export function verifyTotpCode(
  secretBase32: string,
  code: string,
  options: VerifyTotpOptions = {},
): boolean {
  if (typeof code !== "string") return false;
  const trimmed = code.replace(/\s+/g, "");
  if (trimmed.length !== DIGITS) return false;
  if (!/^\d{6}$/.test(trimmed)) return false;

  const window = options.window ?? DEFAULT_WINDOW;
  const now = options.atUnixSeconds ?? Math.floor(Date.now() / 1000);

  let key: Buffer;
  try {
    key = base32Decode(secretBase32);
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const candidate = Buffer.from(trimmed, "utf8");

  for (let drift = -window; drift <= window; drift++) {
    const at = now + drift * STEP_SECONDS;
    const counter = Math.floor(at / STEP_SECONDS);
    const hmac = createHmac("sha1", key).update(counterBuffer(counter)).digest();
    const offset = hmac[hmac.length - 1]! & 0x0f;
    const value =
      ((hmac[offset]! & 0x7f) << 24) |
      ((hmac[offset + 1]! & 0xff) << 16) |
      ((hmac[offset + 2]! & 0xff) << 8) |
      (hmac[offset + 3]! & 0xff);
    const expected = String(value % 10 ** DIGITS).padStart(DIGITS, "0");
    const expectedBuf = Buffer.from(expected, "utf8");
    if (expectedBuf.length === candidate.length) {
      if (timingSafeEqual(expectedBuf, candidate)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// otpauth URI for the QR code
// ---------------------------------------------------------------------------

/**
 * Build an otpauth://totp URL per the Google Authenticator key-uri spec.
 *
 *   issuer   : human-readable account-issuer label (clinic name).
 *   account  : usually the user's email.
 *   secret   : base32 (no padding).
 *
 * The label is `Issuer:account` with both URL-encoded; we also include
 * `issuer=` in the query string because some apps only honour one or the
 * other. SHA-1, 6 digits, 30 second step are the implicit defaults; we
 * spell them out so a non-default authenticator app can't pick wrong.
 */
export function buildOtpauthUrl(args: {
  issuer: string;
  account: string;
  secretBase32: string;
}): string {
  const issuer = encodeURIComponent(args.issuer);
  const account = encodeURIComponent(args.account);
  const params = new URLSearchParams({
    secret: args.secretBase32,
    issuer: args.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${issuer}:${account}?${params.toString()}`;
}

// Test-only constants so unit tests don't have to hard-code the spec.
export const __INTERNALS__ = {
  STEP_SECONDS,
  DIGITS,
  DEFAULT_WINDOW,
};
