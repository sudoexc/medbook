/**
 * Phase 17 Wave 2 — TOTP helper coverage.
 *
 * Pure helpers, so the suite is fully synchronous. We pin Date via
 * `atUnixSeconds` so the assertions don't depend on real-world clock drift.
 */
import { describe, it, expect } from "vitest";

import {
  base32Decode,
  base32Encode,
  buildOtpauthUrl,
  generateTotpCode,
  generateTotpSecret,
  verifyTotpCode,
  __INTERNALS__,
} from "@/server/auth/totp";

describe("base32 round-trip", () => {
  it("encodes and decodes back to the original bytes", () => {
    const buf = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    const enc = base32Encode(buf);
    expect(enc).toMatch(/^[A-Z2-7]+$/);
    const dec = base32Decode(enc);
    expect(dec.equals(buf)).toBe(true);
  });

  it("decode tolerates lowercase, whitespace and trailing padding", () => {
    const buf = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
    const enc = base32Encode(buf);
    const messy = enc.toLowerCase().split("").join(" ") + "==";
    const dec = base32Decode(messy);
    expect(dec.equals(buf)).toBe(true);
  });

  it("decode rejects characters outside the alphabet", () => {
    expect(() => base32Decode("!!!!!")).toThrow();
  });
});

describe("generateTotpSecret", () => {
  it("returns a base32 string of expected length", () => {
    const s = generateTotpSecret();
    // 20 bytes → ceil(160/5) = 32 base32 chars.
    expect(s.length).toBe(32);
    expect(s).toMatch(/^[A-Z2-7]+$/);
  });
});

describe("verifyTotpCode — happy path & windowing", () => {
  const secret = generateTotpSecret();
  const at = 1_700_000_000; // arbitrary fixed instant

  it("accepts the code minted at the same step", () => {
    const code = generateTotpCode(secret, at);
    expect(verifyTotpCode(secret, code, { atUnixSeconds: at })).toBe(true);
  });

  it("accepts the previous step (clock drift backwards)", () => {
    const prevStep = at - __INTERNALS__.STEP_SECONDS;
    const code = generateTotpCode(secret, prevStep);
    expect(verifyTotpCode(secret, code, { atUnixSeconds: at })).toBe(true);
  });

  it("accepts the next step (clock drift forward)", () => {
    const nextStep = at + __INTERNALS__.STEP_SECONDS;
    const code = generateTotpCode(secret, nextStep);
    expect(verifyTotpCode(secret, code, { atUnixSeconds: at })).toBe(true);
  });

  it("rejects a code from two steps ago (outside ±1 window)", () => {
    const stale = at - __INTERNALS__.STEP_SECONDS * 2;
    const code = generateTotpCode(secret, stale);
    expect(verifyTotpCode(secret, code, { atUnixSeconds: at })).toBe(false);
  });

  it("rejects a code from two steps in the future", () => {
    const future = at + __INTERNALS__.STEP_SECONDS * 2;
    const code = generateTotpCode(secret, future);
    expect(verifyTotpCode(secret, code, { atUnixSeconds: at })).toBe(false);
  });

  it("respects an explicit zero window (only the current step)", () => {
    const prev = at - __INTERNALS__.STEP_SECONDS;
    const code = generateTotpCode(secret, prev);
    expect(
      verifyTotpCode(secret, code, { atUnixSeconds: at, window: 0 }),
    ).toBe(false);
  });
});

describe("verifyTotpCode — malformed inputs", () => {
  const secret = generateTotpSecret();

  it("rejects empty string", () => {
    expect(verifyTotpCode(secret, "")).toBe(false);
  });

  it("rejects non-6-digit length", () => {
    expect(verifyTotpCode(secret, "12345")).toBe(false);
    expect(verifyTotpCode(secret, "1234567")).toBe(false);
  });

  it("rejects non-numeric input", () => {
    expect(verifyTotpCode(secret, "abcdef")).toBe(false);
    expect(verifyTotpCode(secret, "12 345")).toBe(false);
  });

  it("rejects when secret can't be decoded", () => {
    // valid format but contains '!'
    expect(verifyTotpCode("!!!!!!!!", "123456")).toBe(false);
  });

  it("rejects when secret decodes to empty buffer", () => {
    expect(verifyTotpCode("", "123456")).toBe(false);
  });

  it("ignores type-confused input safely", () => {
    expect(verifyTotpCode(secret, undefined as unknown as string)).toBe(false);
    expect(verifyTotpCode(secret, 123456 as unknown as string)).toBe(false);
  });
});

describe("buildOtpauthUrl", () => {
  it("produces a well-formed otpauth URL with required params", () => {
    const url = buildOtpauthUrl({
      issuer: "MedBook CRM",
      account: "alice@example.com",
      secretBase32: "JBSWY3DPEHPK3PXP",
    });
    expect(url.startsWith("otpauth://totp/")).toBe(true);
    expect(url).toContain("issuer=MedBook+CRM");
    expect(url).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(url).toContain("algorithm=SHA1");
    expect(url).toContain("digits=6");
    expect(url).toContain("period=30");
    // label is "Issuer:account", URL-encoded
    expect(url).toContain("MedBook%20CRM:alice%40example.com");
  });
});
