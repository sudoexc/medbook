/**
 * Phase 17 Wave 4 — boundary-helper round-trip tests.
 *
 * Verifies that the serialise/hydrate wrappers for Patient / MedicalCase /
 * Prescription:
 *   1. Encrypt the columns they're supposed to encrypt.
 *   2. Leave keys not present on the input untouched (so partial updates don't
 *      null out columns).
 *   3. Hydrate ciphertext back to plaintext on read.
 *   4. Tolerate plaintext on read (legacy / not-yet-backfilled rows).
 *   5. Don't double-encrypt a value that's already prefixed `v<n>:`.
 */
import { randomBytes } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  __resetKeyCacheForTests,
  __setKeyForTests,
  isEncryptedField,
} from "@/server/crypto/field-cipher";
import {
  hydrateMedicalCaseForRead,
  serializeMedicalCaseForWrite,
} from "@/server/medical-case/cipher-fields";
import {
  hydratePatientForRead,
  hydratePatientListForRead,
  serializePatientForWrite,
} from "@/server/patient/cipher-fields";
import {
  hydratePrescriptionForRead,
  serializePrescriptionForWrite,
} from "@/server/prescription/cipher-fields";

const KEY = randomBytes(32);

beforeEach(() => {
  __setKeyForTests({ active: "v1", keys: { v1: KEY } });
});
afterEach(() => {
  __resetKeyCacheForTests();
});

describe("cipher-fields — Patient", () => {
  it("encrypts passport and notes on write, decrypts on read", () => {
    const writePayload = serializePatientForWrite({
      passport: "AB1234567",
      notes: "Аллергия на пенициллин",
    });
    expect(isEncryptedField(writePayload.passport ?? null)).toBe(true);
    expect(isEncryptedField(writePayload.notes ?? null)).toBe(true);

    const hydrated = hydratePatientForRead(writePayload);
    expect(hydrated.passport).toBe("AB1234567");
    expect(hydrated.notes).toBe("Аллергия на пенициллин");
  });

  it("leaves keys absent on the input untouched (partial update)", () => {
    const out = serializePatientForWrite({ passport: "X" });
    expect("notes" in out).toBe(false);
  });

  it("preserves null and empty-string semantics", () => {
    const out = serializePatientForWrite({ passport: null, notes: "" });
    expect(out.passport).toBeNull();
    expect(out.notes).toBe(""); // empty stays empty — no IV burned

    const back = hydratePatientForRead(out);
    expect(back.passport).toBeNull();
    expect(back.notes).toBe("");
  });

  it("tolerates plaintext on read (legacy rows)", () => {
    const back = hydratePatientForRead({
      passport: "PLAIN-LEGACY",
      notes: null,
    });
    expect(back.passport).toBe("PLAIN-LEGACY");
    expect(back.notes).toBeNull();
  });

  it("does not double-encrypt an already-encrypted value passed in", () => {
    const first = serializePatientForWrite({ passport: "AB1234567" });
    const second = serializePatientForWrite({ passport: first.passport });
    expect(second.passport).toBe(first.passport);
  });

  it("hydrates a list of rows", () => {
    const a = serializePatientForWrite({ passport: "P1" });
    const b = serializePatientForWrite({ passport: "P2" });
    const list = hydratePatientListForRead([
      { passport: a.passport ?? null },
      { passport: b.passport ?? null },
    ]);
    expect(list[0]!.passport).toBe("P1");
    expect(list[1]!.passport).toBe("P2");
  });
});

describe("cipher-fields — MedicalCase", () => {
  it("encrypts soapDraft on write, decrypts on read", () => {
    const md = "## SOAP\n\n**S:** patient reports headache\n**O:** BP 120/80";
    const out = serializeMedicalCaseForWrite({ soapDraft: md });
    expect(isEncryptedField(out.soapDraft ?? null)).toBe(true);
    const back = hydrateMedicalCaseForRead(out);
    expect(back.soapDraft).toBe(md);
  });

  it("leaves soapDraft alone when not present on input", () => {
    const out = serializeMedicalCaseForWrite({});
    expect("soapDraft" in out).toBe(false);
  });

  it("tolerates plaintext on read", () => {
    const back = hydrateMedicalCaseForRead({
      soapDraft: "legacy-plaintext-soap",
    });
    expect(back.soapDraft).toBe("legacy-plaintext-soap");
  });
});

describe("cipher-fields — Prescription", () => {
  it("encrypts notes on write, decrypts on read", () => {
    const out = serializePrescriptionForWrite({
      notes: "Continue if no rash develops",
    });
    expect(isEncryptedField(out.notes ?? null)).toBe(true);
    const back = hydratePrescriptionForRead(out);
    expect(back.notes).toBe("Continue if no rash develops");
  });

  it("leaves notes alone when not present", () => {
    const out = serializePrescriptionForWrite({});
    expect("notes" in out).toBe(false);
  });

  it("nulls round-trip as nulls", () => {
    const out = serializePrescriptionForWrite({ notes: null });
    expect(out.notes).toBeNull();
    expect(hydratePrescriptionForRead(out).notes).toBeNull();
  });
});
