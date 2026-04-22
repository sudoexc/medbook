/**
 * AES-256-GCM utility tests. Covers the happy path, tampering, format
 * validation, and env-var fallback.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  __resetCryptoCacheForTests,
  constantTimeEqual,
  decrypt,
  encrypt,
  maskSecret,
} from "@/server/crypto/secrets";

const ORIGINAL_APP_SECRET = process.env.APP_SECRET;
const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;

describe("crypto/secrets — encrypt/decrypt", () => {
  beforeEach(() => {
    process.env.APP_SECRET = "test-secret-one-do-not-use-in-prod";
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

  it("round-trips a simple string", () => {
    const plain = "my-sms-api-key-123";
    const enc = encrypt(plain);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc.split(":")).toHaveLength(4);
    expect(enc).not.toContain(plain);
    expect(decrypt(enc)).toBe(plain);
  });

  it("round-trips unicode, emojis, long payloads", () => {
    const plain =
      "سلام — 🔐 apikey=ABC\n" + "ы".repeat(500) + "\n🌳 end";
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it("round-trips empty string", () => {
    expect(decrypt(encrypt(""))).toBe("");
  });

  it("produces distinct ciphertexts for the same plaintext (random IV)", () => {
    const plain = "constant";
    const a = encrypt(plain);
    const b = encrypt(plain);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(plain);
    expect(decrypt(b)).toBe(plain);
  });

  it("throws when ciphertext is tampered (bit flip in body)", () => {
    const enc = encrypt("hello");
    const parts = enc.split(":");
    // Flip a byte inside the ciphertext section.
    const ctBuf = Buffer.from(parts[3]!, "base64");
    ctBuf[0] = ctBuf[0]! ^ 0x01;
    parts[3] = ctBuf.toString("base64");
    const tampered = parts.join(":");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws when auth tag is tampered", () => {
    const enc = encrypt("hello");
    const parts = enc.split(":");
    const tagBuf = Buffer.from(parts[2]!, "base64");
    tagBuf[0] = tagBuf[0]! ^ 0x01;
    parts[2] = tagBuf.toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("throws when key changes between encrypt and decrypt", () => {
    const enc = encrypt("hello");
    process.env.APP_SECRET = "a-completely-different-secret-value";
    __resetCryptoCacheForTests();
    expect(() => decrypt(enc)).toThrow();
  });

  it("throws on malformed ciphertext (wrong segment count)", () => {
    expect(() => decrypt("v1:only:three")).toThrow();
    expect(() => decrypt("")).toThrow();
  });

  it("throws on unsupported version tag", () => {
    const enc = encrypt("hello");
    const mutated = "v9" + enc.slice(2);
    expect(() => decrypt(mutated)).toThrow(/version/);
  });

  it("falls back to AUTH_SECRET when APP_SECRET is absent", () => {
    delete process.env.APP_SECRET;
    process.env.AUTH_SECRET = "only-auth-secret-set";
    __resetCryptoCacheForTests();
    const enc = encrypt("fallback-ok");
    expect(decrypt(enc)).toBe("fallback-ok");
  });

  it("throws when neither APP_SECRET nor AUTH_SECRET is set", () => {
    delete process.env.APP_SECRET;
    delete process.env.AUTH_SECRET;
    __resetCryptoCacheForTests();
    expect(() => encrypt("anything")).toThrow(/APP_SECRET/);
  });
});

describe("crypto/secrets — maskSecret", () => {
  it("returns empty for null / undefined / empty", () => {
    expect(maskSecret(null)).toBe("");
    expect(maskSecret(undefined)).toBe("");
    expect(maskSecret("")).toBe("");
  });

  it("masks short strings without leaking characters", () => {
    expect(maskSecret("abc")).toBe("••••");
    expect(maskSecret("abcd")).toBe("••••");
  });

  it("shows the last 4 for longer strings", () => {
    expect(maskSecret("0123456789")).toBe("••••6789");
    expect(maskSecret("api-key-xyzlast4")).toBe("••••ast4");
  });
});

describe("crypto/secrets — constantTimeEqual", () => {
  it("returns true for equal strings", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
  });
  it("returns false for different strings", () => {
    expect(constantTimeEqual("abc", "abd")).toBe(false);
  });
  it("returns false for different lengths", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});
