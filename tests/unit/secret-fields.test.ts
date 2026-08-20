/**
 * Boundary-helper tests for auth-secret encryption at rest
 * (`User.totpSecret` / `User.pendingTotpSecret` / `Clinic.tgBotToken`).
 *
 * Covers the three properties the migration depends on:
 *   1. encrypt→decrypt round-trip through the write/read helpers;
 *   2. legacy plaintext (pre-backfill prod rows) passes through reads —
 *      including a Telegram token, whose embedded colon must NOT be mistaken
 *      for the ciphertext envelope;
 *   3. idempotency — re-writing ciphertext or re-running the backfill's
 *      per-cell function never double-encrypts.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  __resetCryptoCacheForTests,
  decrypt,
  isEncryptedSecret,
} from "@/server/crypto/secrets";
import {
  readTgBotToken,
  readTotpSecret,
  writeTgBotToken,
  writeTotpSecret,
} from "@/server/crypto/secret-fields";
import { reencryptSecretValue } from "../../scripts/encrypt-auth-secrets";

// Realistic shapes: base32 TOTP seed (no colon), Telegram token (one colon).
const TOTP_PLAIN = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const TOKEN_PLAIN = "123456789:AAEhBOweik6ad9r_QXMENQjcG6BqLQnBHm4";

const ORIGINAL_APP_SECRET = process.env.APP_SECRET;
const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;

beforeEach(() => {
  process.env.APP_SECRET = "test-secret-for-secret-fields";
  __resetCryptoCacheForTests();
});

afterEach(() => {
  if (typeof ORIGINAL_APP_SECRET === "string") {
    process.env.APP_SECRET = ORIGINAL_APP_SECRET;
  } else {
    delete process.env.APP_SECRET;
  }
  if (typeof ORIGINAL_AUTH_SECRET === "string") {
    process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
  } else {
    delete process.env.AUTH_SECRET;
  }
  __resetCryptoCacheForTests();
});

describe("secret-fields — round-trip", () => {
  it("encrypts a TOTP secret on write and recovers it on read", () => {
    const stored = writeTotpSecret(TOTP_PLAIN);
    expect(stored).not.toBe(TOTP_PLAIN);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored.split(":")).toHaveLength(4);
    expect(stored).not.toContain(TOTP_PLAIN);
    expect(readTotpSecret(stored)).toBe(TOTP_PLAIN);
  });

  it("encrypts a bot token on write and recovers it on read", () => {
    const stored = writeTgBotToken(TOKEN_PLAIN);
    expect(stored).not.toBe(TOKEN_PLAIN);
    expect(isEncryptedSecret(stored)).toBe(true);
    expect(stored).not.toContain(TOKEN_PLAIN.split(":")[1]);
    expect(readTgBotToken(stored)).toBe(TOKEN_PLAIN);
  });

  it("passes null / empty through both directions", () => {
    expect(writeTotpSecret(null)).toBeNull();
    expect(readTotpSecret(null)).toBeNull();
    expect(readTotpSecret(undefined)).toBeNull();
    expect(writeTgBotToken(null)).toBeNull();
    expect(readTgBotToken(null)).toBeNull();
    // Empty string = "explicitly cleared" marker, not a secret.
    expect(writeTgBotToken("")).toBe("");
    expect(readTgBotToken("")).toBe("");
  });

  it("fails loudly (not open) on tampered ciphertext", () => {
    const stored = writeTotpSecret(TOTP_PLAIN);
    const parts = stored.split(":");
    const ct = Buffer.from(parts[3]!, "base64");
    ct[0] = ct[0]! ^ 0x01;
    parts[3] = ct.toString("base64");
    expect(() => readTotpSecret(parts.join(":"))).toThrow();
  });
});

describe("secret-fields — legacy plaintext compatibility", () => {
  it("returns a legacy plaintext TOTP secret unchanged", () => {
    expect(readTotpSecret(TOTP_PLAIN)).toBe(TOTP_PLAIN);
  });

  it("returns a legacy plaintext bot token unchanged (colon is not an envelope)", () => {
    // A TG token splits on ":" into 2 segments and its head is numeric — the
    // 4-segment `v<n>:` check must not classify it as ciphertext.
    expect(isEncryptedSecret(TOKEN_PLAIN)).toBe(false);
    expect(readTgBotToken(TOKEN_PLAIN)).toBe(TOKEN_PLAIN);
  });

  it("does not misdetect other colon-y plaintext", () => {
    expect(isEncryptedSecret("v1:only:three")).toBe(false); // 3 segments
    expect(isEncryptedSecret("a:b:c:d")).toBe(false); // no v<n> head
    expect(isEncryptedSecret("")).toBe(false);
    expect(isEncryptedSecret(null)).toBe(false);
  });
});

describe("secret-fields — idempotency", () => {
  it("write of an already-encrypted value is a pass-through (no double-encrypt)", () => {
    const once = writeTgBotToken(TOKEN_PLAIN);
    const twice = writeTgBotToken(once);
    expect(twice).toBe(once); // byte-identical, not re-wrapped
    expect(readTgBotToken(twice)).toBe(TOKEN_PLAIN);

    const totpOnce = writeTotpSecret(TOTP_PLAIN);
    expect(writeTotpSecret(totpOnce)).toBe(totpOnce);
  });
});

describe("encrypt-auth-secrets — reencryptSecretValue", () => {
  function freshStats() {
    return {
      scanned: 0,
      alreadyEncrypted: 0,
      encrypted: 0,
      skippedNull: 0,
      errors: 0,
    };
  }

  it("encrypts plaintext and returns write=true", () => {
    const stats = freshStats();
    const r = reencryptSecretValue(TOKEN_PLAIN, stats);
    expect(r.write).toBe(true);
    expect(isEncryptedSecret(r.next)).toBe(true);
    expect(decrypt(r.next as string)).toBe(TOKEN_PLAIN);
    expect(stats.encrypted).toBe(1);
  });

  it("skips null and empty without writing", () => {
    const stats = freshStats();
    expect(reencryptSecretValue(null, stats)).toEqual({
      write: false,
      next: null,
    });
    expect(reencryptSecretValue("", stats)).toEqual({ write: false, next: "" });
    expect(stats.skippedNull).toBe(2);
    expect(stats.encrypted).toBe(0);
  });

  it("is idempotent: a second pass over its own output writes nothing", () => {
    const first = freshStats();
    const r1 = reencryptSecretValue(TOTP_PLAIN, first);
    expect(r1.write).toBe(true);

    const second = freshStats();
    const r2 = reencryptSecretValue(r1.next, second);
    expect(r2.write).toBe(false);
    expect(r2.next).toBe(r1.next); // untouched ciphertext
    expect(second.alreadyEncrypted).toBe(1);
    expect(second.encrypted).toBe(0);
  });
});
