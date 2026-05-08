/**
 * Phase 17 Wave 4 — pure-function tests for the backfill helper.
 *
 * The DB-walking parts of `scripts/encrypt-existing-pii.ts` aren't unit-
 * testable without a live Postgres, but the per-cell decision logic
 * (`reencryptValue`) is a pure function and is exported specifically for
 * this test.
 */
import { randomBytes } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  __resetKeyCacheForTests,
  __setKeyForTests,
  isEncryptedField,
} from "@/server/crypto/field-cipher";
import { reencryptValue } from "../../scripts/encrypt-existing-pii";

const KEY = randomBytes(32);

beforeEach(() => {
  __setKeyForTests({ active: "v1", keys: { v1: KEY } });
});
afterEach(() => {
  __resetKeyCacheForTests();
});

describe("encrypt-existing-pii — reencryptValue", () => {
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
    const out = reencryptValue("AB1234567", stats);
    expect(out.write).toBe(true);
    expect(isEncryptedField(out.next)).toBe(true);
    expect(stats.encrypted).toBe(1);
  });

  it("skips already-encrypted values (idempotent)", () => {
    const stats = freshStats();
    // First call produces ciphertext.
    const first = reencryptValue("AB1234567", stats);
    // Second call passes that ciphertext back in; should NOT re-encrypt.
    const second = reencryptValue(first.next, stats);
    expect(second.write).toBe(false);
    expect(second.next).toBe(first.next);
    expect(stats.alreadyEncrypted).toBe(1);
  });

  it("treats null as skip", () => {
    const stats = freshStats();
    const out = reencryptValue(null, stats);
    expect(out.write).toBe(false);
    expect(out.next).toBeNull();
    expect(stats.skippedNull).toBe(1);
  });

  it("treats empty string as skip (no IV burn)", () => {
    const stats = freshStats();
    const out = reencryptValue("", stats);
    expect(out.write).toBe(false);
    expect(out.next).toBe("");
    expect(stats.skippedNull).toBe(1);
  });
});
