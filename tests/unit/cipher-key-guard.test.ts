/**
 * Audit G2-11: the encryption backfills wrote ciphertext under whatever key
 * their own process resolved. encrypt-auth-secrets loaded the laptop's .env
 * next to a production DATABASE_URL and only checked that SOME secret was
 * set; encrypt-existing-pii printed a WARNING and encrypted real passports
 * under the public dev key. Either way the app could no longer read the rows
 * (patient cards 500, 2FA sign-in and clinic bots broken), and the dev key
 * made them readable to anyone with a dump and the source.
 *
 * Pinned (the card's acceptance): a run with a wrong or missing key against a
 * database that already holds ciphertext fails BEFORE the first write; the
 * dev key and the .env.example placeholder are refused outside local
 * development; the check is the GCM-authenticated decrypt of existing cells
 * (the key's fingerprint, in effect), unit tested here.
 */
import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __resetKeyCacheForTests,
  __setKeyForTests,
  decryptField,
  describeActiveKey,
  encryptField,
} from "@/server/crypto/field-cipher";
import {
  __resetCryptoCacheForTests,
  describeAppSecret,
  encrypt,
} from "@/server/crypto/secrets";
import { keyFingerprint } from "@/server/crypto/key-fingerprint";
import {
  decideKeyCheck,
  isLocalDatabaseUrl,
  looksLikeCiphertext,
} from "../../scripts/_cipher-key-guard";
import {
  checkPiiKey,
  type PiiColumnReader,
} from "../../scripts/encrypt-existing-pii";
import { checkAuthSecretKey } from "../../scripts/encrypt-auth-secrets";

const KEY_A = randomBytes(32);
const KEY_B = randomBytes(32);
const PROD_DB = "postgresql://medbook:x@postgres:5432/medbook";
const LOCAL_DB = "postgresql://medbook:x@localhost:5433/medbook";
const WORKER_ENV = { NODE_ENV: "production", DATABASE_URL: PROD_DB };
const LAPTOP_ON_PROD = { DATABASE_URL: PROD_DB };
const LAPTOP_LOCAL = { NODE_ENV: "development", DATABASE_URL: LOCAL_DB };

function cipherUnder(key: Buffer, plaintext: string): string {
  __setKeyForTests({ active: "v1", keys: { v1: key } });
  const ct = encryptField(plaintext);
  __resetKeyCacheForTests();
  return ct;
}

afterEach(() => {
  __resetKeyCacheForTests();
});

describe("looksLikeCiphertext / isLocalDatabaseUrl", () => {
  it("recognises our envelope and nothing that merely starts with v<n>:", () => {
    expect(looksLikeCiphertext(cipherUnder(KEY_A, "AB1234567"))).toBe(true);
    expect(looksLikeCiphertext(cipherUnder(KEY_A, ""))).toBe(true);
    expect(looksLikeCiphertext("v2: follow-up in a week")).toBe(false);
    expect(looksLikeCiphertext("vertigo since May")).toBe(false);
    expect(looksLikeCiphertext(null)).toBe(false);
  });

  it("treats only this machine as local", () => {
    expect(isLocalDatabaseUrl(LOCAL_DB)).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://u:p@127.0.0.1/db")).toBe(true);
    expect(isLocalDatabaseUrl(PROD_DB)).toBe(false);
    expect(isLocalDatabaseUrl("postgresql://u:p@167.233.142.75:5432/db")).toBe(false);
    expect(isLocalDatabaseUrl(undefined)).toBe(false);
  });
});

describe("decideKeyCheck", () => {
  const samplesUnder = (key: Buffer) => [
    { where: "Patient.passport p1", value: cipherUnder(key, "AA1234567") },
    { where: "Patient.notes p2", value: cipherUnder(key, "аллергия на пенициллин") },
  ];
  const decryptWith = (key: Buffer) => (v: string) => {
    __setKeyForTests({ active: "v1", keys: { v1: key } });
    try {
      return decryptField(v);
    } finally {
      __resetKeyCacheForTests();
    }
  };

  it("passes when existing ciphertext decrypts with this key", () => {
    const d = decideKeyCheck({
      script: "t",
      samples: samplesUnder(KEY_A),
      decrypt: decryptWith(KEY_A),
      env: WORKER_ENV,
      argv: [],
    });
    expect(d).toEqual({ ok: true, checked: 2, firstRun: false });
  });

  it("refuses a different key and names the cell that did not decrypt", () => {
    const d = decideKeyCheck({
      script: "t",
      samples: samplesUnder(KEY_A),
      decrypt: decryptWith(KEY_B),
      env: WORKER_ENV,
      argv: [],
    });
    expect(d).toMatchObject({ ok: false, reason: "key_mismatch" });
    if (!d.ok) expect(d.message).toContain("Patient.passport p1");
  });

  it("refuses the dev key everywhere but a local development database", () => {
    for (const env of [WORKER_ENV, LAPTOP_ON_PROD, { NODE_ENV: "production", DATABASE_URL: LOCAL_DB }]) {
      const d = decideKeyCheck({
        script: "t",
        isDevKey: true,
        samples: [],
        decrypt: () => "",
        env,
        argv: ["--first-run"],
      });
      expect(d).toMatchObject({ ok: false, reason: "dev_key" });
    }
    expect(
      decideKeyCheck({
        script: "t",
        isDevKey: true,
        samples: [],
        decrypt: () => "",
        env: LAPTOP_LOCAL,
        argv: [],
      }),
    ).toEqual({ ok: true, checked: 0, firstRun: true });
  });

  it("refuses the .env.example placeholder secret outside local development", () => {
    const d = decideKeyCheck({
      script: "t",
      isPlaceholderSecret: true,
      samples: [],
      decrypt: () => "",
      env: LAPTOP_ON_PROD,
      argv: ["--first-run"],
    });
    expect(d).toMatchObject({ ok: false, reason: "placeholder_secret" });
  });

  it("needs --first-run on a remote database with nothing to compare against", () => {
    const base = { script: "t", samples: [], decrypt: () => "", env: WORKER_ENV };
    expect(decideKeyCheck({ ...base, argv: [] })).toMatchObject({
      ok: false,
      reason: "no_reference",
    });
    expect(decideKeyCheck({ ...base, argv: ["--first-run"] })).toEqual({
      ok: true,
      checked: 0,
      firstRun: true,
    });
  });
});

describe("encrypt-existing-pii key check", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {};
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("FIELD_ENCRYPTION_KEY")) {
        saved[k] = process.env[k];
        delete process.env[k];
      }
    }
  });
  afterEach(() => {
    Object.assign(process.env, saved);
  });

  function readerOf(rows: Partial<Record<string, Array<{ id: string; value: string | null }>>>): PiiColumnReader {
    return async (column) => rows[column] ?? [];
  }

  it("stops a run whose key does not open the app's ciphertext", async () => {
    const reader = readerOf({
      "Patient.passport": [{ id: "p9", value: cipherUnder(KEY_A, "AA7654321") }],
      "MedicalCase.soapDraft": [{ id: "m1", value: "plain draft" }],
    });
    __setKeyForTests({ active: "v1", keys: { v1: KEY_B } });
    const { decision } = await checkPiiKey(reader, WORKER_ENV, []);
    expect(decision).toMatchObject({ ok: false, reason: "key_mismatch" });

    __setKeyForTests({ active: "v1", keys: { v1: KEY_A } });
    const same = await checkPiiKey(reader, WORKER_ENV, []);
    expect(same.decision).toEqual({ ok: true, checked: 1, firstRun: false });
  });

  it("refuses the public dev key (no FIELD_ENCRYPTION_KEY) on a remote database", async () => {
    __resetKeyCacheForTests();
    const { key, decision } = await checkPiiKey(readerOf({}), LAPTOP_ON_PROD, [
      "--first-run",
    ]);
    expect(key.isDevFallback).toBe(true);
    expect(decision).toMatchObject({ ok: false, reason: "dev_key" });
  });

  it("prints a fingerprint, never the key", () => {
    __setKeyForTests({ active: "v1", keys: { v1: KEY_A } });
    const k = describeActiveKey();
    expect(k.fingerprint).toBe(keyFingerprint(KEY_A));
    expect(k.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(keyFingerprint(KEY_B)).not.toBe(k.fingerprint);
    expect(k.fingerprint).not.toContain(KEY_A.toString("hex").slice(0, 12));
  });
});

describe("encrypt-auth-secrets key check", () => {
  let savedApp: string | undefined;
  let savedAuth: string | undefined;
  beforeEach(() => {
    savedApp = process.env.APP_SECRET;
    savedAuth = process.env.AUTH_SECRET;
  });
  afterEach(() => {
    if (savedApp === undefined) delete process.env.APP_SECRET;
    else process.env.APP_SECRET = savedApp;
    if (savedAuth === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = savedAuth;
    __resetCryptoCacheForTests();
  });

  function secretUnder(appSecret: string, plaintext: string): string {
    process.env.APP_SECRET = appSecret;
    __resetCryptoCacheForTests();
    return encrypt(plaintext);
  }

  it("stops a laptop secret against the app's ciphertext", () => {
    const rows = {
      users: [{ id: "u1", totpSecret: secretUnder("server-secret", "JBSWY3DPEHPK3PXP") }],
      clinics: [{ slug: "neurofax", tgBotToken: secretUnder("server-secret", "123456:AAE-token") }],
    };
    process.env.APP_SECRET = "laptop-secret";
    __resetCryptoCacheForTests();
    const bad = checkAuthSecretKey(rows, LAPTOP_ON_PROD, []);
    expect(bad.decision).toMatchObject({ ok: false, reason: "key_mismatch" });

    process.env.APP_SECRET = "server-secret";
    __resetCryptoCacheForTests();
    const good = checkAuthSecretKey(rows, WORKER_ENV, []);
    expect(good.decision).toEqual({ ok: true, checked: 2, firstRun: false });
    expect(good.secret.source).toBe("APP_SECRET");
  });

  it("ignores plaintext legacy values when sampling", () => {
    process.env.APP_SECRET = "server-secret";
    __resetCryptoCacheForTests();
    const r = checkAuthSecretKey(
      { users: [{ id: "u1", totpSecret: "JBSWY3DPEHPK3PXP" }], clinics: [] },
      WORKER_ENV,
      ["--first-run"],
    );
    expect(r.decision).toEqual({ ok: true, checked: 0, firstRun: true });
  });

  it("refuses the .env.example placeholder on a remote database", () => {
    process.env.APP_SECRET = "change-me-openssl-rand-base64-32";
    __resetCryptoCacheForTests();
    expect(describeAppSecret().isPlaceholder).toBe(true);
    const r = checkAuthSecretKey({ users: [], clinics: [] }, LAPTOP_ON_PROD, ["--first-run"]);
    expect(r.decision).toMatchObject({ ok: false, reason: "placeholder_secret" });
  });
});
