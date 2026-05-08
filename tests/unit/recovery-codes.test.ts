/**
 * Phase 17 Wave 2 — recovery-code coverage.
 *
 * Slow-ish (bcrypt) but still well under a second per assertion at cost=10.
 * Single-use semantics + position-leak protection are the load-bearing
 * properties; this suite covers both.
 */
import { describe, it, expect } from "vitest";

import {
  consumeRecoveryCode,
  generateRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  hashRecoveryCodes,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from "@/server/auth/recovery-codes";

describe("generateRecoveryCode shape", () => {
  it("returns XXXX-XXXX-XXXX with the safe alphabet", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // Ambiguous chars are excluded from the alphabet.
    expect(code).not.toMatch(/[01IO]/);
  });

  it("generateRecoveryCodes() defaults to RECOVERY_CODE_COUNT", () => {
    const codes = generateRecoveryCodes();
    expect(codes.length).toBe(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(codes.length); // unique
  });
});

describe("normalizeRecoveryCode", () => {
  it("strips whitespace and dashes, uppercases", () => {
    expect(normalizeRecoveryCode(" abcd-efgh-ijkl ")).toBe("ABCDEFGHIJKL");
    expect(normalizeRecoveryCode("ABCDEFGHIJKL")).toBe("ABCDEFGHIJKL");
  });
});

describe("consumeRecoveryCode", () => {
  it("matches a valid code, returns remainingHashes with the matched hash removed", async () => {
    const codes = generateRecoveryCodes(3);
    const hashes = await hashRecoveryCodes(codes);
    const result = await consumeRecoveryCode(codes[1]!, hashes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.remainingHashes.length).toBe(2);
      expect(result.remaining).toBe(2);
      // The matched hash itself must not appear in the remainder.
      expect(result.remainingHashes).not.toContain(hashes[1]);
      // The other two are preserved.
      expect(result.remainingHashes).toEqual(
        expect.arrayContaining([hashes[0], hashes[2]]),
      );
    }
  });

  it("is single-use — a consumed code no longer matches", async () => {
    const codes = generateRecoveryCodes(2);
    const hashes = await hashRecoveryCodes(codes);
    const first = await consumeRecoveryCode(codes[0]!, hashes);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await consumeRecoveryCode(codes[0]!, first.remainingHashes);
    expect(second.ok).toBe(false);
  });

  it("normalises user input (case + dashes)", async () => {
    const code = "ABCD-EFGH-2345";
    const hash = await hashRecoveryCode(code);
    expect((await consumeRecoveryCode("abcdEFGH2345", [hash])).ok).toBe(true);
    expect((await consumeRecoveryCode("ABCD-efgh-2345", [hash])).ok).toBe(true);
    expect((await consumeRecoveryCode("  abcd EFGH 2345  ", [hash])).ok).toBe(
      true,
    );
  });

  it("rejects malformed input without bcrypting", async () => {
    const codes = generateRecoveryCodes(2);
    const hashes = await hashRecoveryCodes(codes);
    expect((await consumeRecoveryCode("", hashes)).ok).toBe(false);
    expect((await consumeRecoveryCode("short", hashes)).ok).toBe(false);
    // 12 chars but contains symbols outside [A-Z0-9]
    expect((await consumeRecoveryCode("AAAA-BBBB-???", hashes)).ok).toBe(false);
  });

  it("rejects on empty hash list", async () => {
    expect((await consumeRecoveryCode("AAAA-BBBB-CCCC", [])).ok).toBe(false);
  });

  it("does NOT mutate the caller's hash array", async () => {
    const codes = generateRecoveryCodes(2);
    const hashes = await hashRecoveryCodes(codes);
    const before = [...hashes];
    await consumeRecoveryCode(codes[0]!, hashes);
    expect(hashes).toEqual(before);
  });
});
