/**
 * Phase 17 Wave 4 — field-cipher unit tests.
 *
 * Covers the encrypt/decrypt round-trip, tampering detection, version routing
 * across multiple keys, null-safety, the `isEncryptedField` predicate, and the
 * `__setKeyForTests` override helper.
 */
import { randomBytes } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  __resetKeyCacheForTests,
  __setKeyForTests,
  decryptField,
  encryptField,
  getActiveKeyVersion,
  getKnownKeyVersions,
  isEncryptedField,
  readVersionPrefix,
} from "@/server/crypto/field-cipher";

const KEY_V1 = randomBytes(32);
const KEY_V2 = randomBytes(32);
const KEY_V3 = randomBytes(32);

describe("field-cipher — round-trip", () => {
  beforeEach(() => {
    __setKeyForTests({ active: "v1", keys: { v1: KEY_V1 } });
  });
  afterEach(() => {
    __resetKeyCacheForTests();
  });

  it("round-trips ASCII", () => {
    const enc = encryptField("hello-world");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc.split(":")).toHaveLength(4);
    expect(enc).not.toContain("hello-world");
    expect(decryptField(enc)).toBe("hello-world");
  });

  it("round-trips unicode and long inputs", () => {
    const plain =
      "Привет — 🔐 паспорт=AB1234567\n" + "ы".repeat(2000) + "\n🌳 end";
    expect(decryptField(encryptField(plain))).toBe(plain);
  });

  it("encrypts the empty string and round-trips it", () => {
    expect(decryptField(encryptField(""))).toBe("");
  });

  it("produces distinct ciphertexts for the same plaintext", () => {
    const a = encryptField("constant");
    const b = encryptField("constant");
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe("constant");
    expect(decryptField(b)).toBe("constant");
  });

  it("throws on tag tampering", () => {
    const enc = encryptField("hi");
    const parts = enc.split(":");
    const tag = Buffer.from(parts[2]!, "base64");
    tag[0] = tag[0]! ^ 0x01;
    parts[2] = tag.toString("base64");
    expect(() => decryptField(parts.join(":"))).toThrow();
  });

  it("throws on ciphertext tampering", () => {
    const enc = encryptField("hi");
    const parts = enc.split(":");
    const ct = Buffer.from(parts[3]!, "base64");
    ct[0] = ct[0]! ^ 0x01;
    parts[3] = ct.toString("base64");
    expect(() => decryptField(parts.join(":"))).toThrow();
  });

  it("throws on malformed ciphertext", () => {
    expect(() => decryptField("v1:only:three")).toThrow();
    expect(() => decryptField("not-encrypted-at-all")).toThrow();
  });

  it("throws on unknown version prefix", () => {
    const enc = encryptField("hi");
    const mutated = "v9" + enc.slice(2);
    expect(() => decryptField(mutated)).toThrow(/version|key/);
  });
});

describe("field-cipher — null-safety", () => {
  beforeEach(() => {
    __setKeyForTests({ active: "v1", keys: { v1: KEY_V1 } });
  });
  afterEach(() => {
    __resetKeyCacheForTests();
  });

  it("decryptField passes null through", () => {
    expect(decryptField(null)).toBeNull();
  });

  it("decryptField passes undefined through", () => {
    expect(decryptField(undefined as unknown as string | null)).toBeNull();
  });

  it("encryptField rejects non-string", () => {
    expect(() => encryptField(null as unknown as string)).toThrow();
    expect(() => encryptField(123 as unknown as string)).toThrow();
  });
});

describe("field-cipher — multi-version resolution", () => {
  afterEach(() => {
    __resetKeyCacheForTests();
  });

  it("active is the highest numeric suffix", () => {
    __setKeyForTests({
      active: "v3",
      keys: { v1: KEY_V1, v2: KEY_V2, v3: KEY_V3 },
    });
    expect(getActiveKeyVersion()).toBe("v3");
    expect(getKnownKeyVersions()).toEqual(["v1", "v2", "v3"]);
  });

  it("encrypt always writes under the active version", () => {
    __setKeyForTests({
      active: "v2",
      keys: { v1: KEY_V1, v2: KEY_V2 },
    });
    const enc = encryptField("active-test");
    expect(enc.startsWith("v2:")).toBe(true);
    expect(decryptField(enc)).toBe("active-test");
  });

  it("decrypt routes to the right key by prefix even after rotation", () => {
    // First encrypt under v1.
    __setKeyForTests({ active: "v1", keys: { v1: KEY_V1 } });
    const oldCt = encryptField("rotated-payload");
    expect(oldCt.startsWith("v1:")).toBe(true);

    // Now imagine a rotation: v2 is active, v1 still readable.
    __setKeyForTests({
      active: "v2",
      keys: { v1: KEY_V1, v2: KEY_V2 },
    });
    expect(getActiveKeyVersion()).toBe("v2");
    expect(decryptField(oldCt)).toBe("rotated-payload");

    // New writes are v2.
    const newCt = encryptField("rotated-payload");
    expect(newCt.startsWith("v2:")).toBe(true);
    expect(decryptField(newCt)).toBe("rotated-payload");
  });

  it("decrypt under a stale version with the old key dropped throws", () => {
    __setKeyForTests({ active: "v1", keys: { v1: KEY_V1 } });
    const v1Ct = encryptField("orphan");
    __setKeyForTests({ active: "v2", keys: { v2: KEY_V2 } }); // v1 dropped
    expect(() => decryptField(v1Ct)).toThrow(/key/);
  });
});

describe("field-cipher — isEncryptedField / readVersionPrefix", () => {
  beforeEach(() => {
    __setKeyForTests({ active: "v1", keys: { v1: KEY_V1 } });
  });
  afterEach(() => {
    __resetKeyCacheForTests();
  });

  it("recognises produced ciphertext", () => {
    const ct = encryptField("anything");
    expect(isEncryptedField(ct)).toBe(true);
    expect(readVersionPrefix(ct)).toBe("v1");
  });

  it("rejects null / undefined / empty / plaintext", () => {
    expect(isEncryptedField(null)).toBe(false);
    expect(isEncryptedField("")).toBe(false);
    expect(isEncryptedField("plaintext-no-prefix")).toBe(false);
    expect(isEncryptedField("v:bad")).toBe(false);
    expect(isEncryptedField("vX:bad")).toBe(false);
    expect(isEncryptedField("vno-colon")).toBe(false);
  });

  it("readVersionPrefix returns null for plaintext", () => {
    expect(readVersionPrefix("plaintext")).toBeNull();
    expect(readVersionPrefix(null)).toBeNull();
  });

  it("readVersionPrefix accepts higher version numbers", () => {
    __setKeyForTests({ active: "v17", keys: { v17: randomBytes(32) } });
    const ct = encryptField("hi");
    expect(readVersionPrefix(ct)).toBe("v17");
  });
});
