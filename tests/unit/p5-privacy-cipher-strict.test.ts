/**
 * Audit G1-08: a note that merely starts with «v1:» was taken for
 * ciphertext, stored in plain text, and then failed to decrypt on every
 * read; one such card (or a damaged envelope, or a retired key) turned the
 * patients list and the card into a 500, and ENCRYPTION_DECRYPT_FAILED was
 * never written.
 *
 * Acceptance: the note «v1: тест» is stored as ciphertext and reads back;
 * a damaged ciphertext reads as an empty field, the read does not throw,
 * and the failure is reported (once) with entity, field and key version,
 * never plaintext.
 */
import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __resetKeyCacheForTests,
  __setKeyForTests,
  encryptField,
  isEncryptedField,
} from "@/server/crypto/field-cipher";
import {
  __setDecryptFailureReporterForTests,
  type DecryptFailure,
} from "@/server/crypto/decrypt-failure";
import {
  hydratePatientForRead,
  hydratePatientListForRead,
  serializePatientForWrite,
} from "@/server/patient/cipher-fields";
import { hydrateMedicalCaseForRead } from "@/server/medical-case/cipher-fields";
import { hydratePrescriptionForRead } from "@/server/prescription/cipher-fields";
import { readClinicalNoteBody } from "@/server/patient/clinical-note";

let reported: DecryptFailure[] = [];

beforeEach(() => {
  __setKeyForTests({ active: "v1", keys: { v1: randomBytes(32) } });
  reported = [];
  __setDecryptFailureReporterForTests((f) => reported.push(f));
});
afterEach(() => {
  __resetKeyCacheForTests();
  __setDecryptFailureReporterForTests(null);
});

describe("isEncryptedField is strict", () => {
  it("accepts only the real envelope", () => {
    expect(isEncryptedField(encryptField("AB1234567"))).toBe(true);
    expect(isEncryptedField(encryptField(""))).toBe(true);
    for (const text of [
      "v1: первичный, v2: повтор",
      "v2: перезвонить после МРТ",
      "v1:abc",
      "v1:iv:tag:ct",
      "v12:x:y:z",
    ]) {
      expect(isEncryptedField(text), text).toBe(false);
    }
  });
});

describe("a note starting with «v1:»", () => {
  it("is encrypted on write and reads back", () => {
    const written = serializePatientForWrite({ notes: "v1: тест" });
    expect(written.notes).not.toBe("v1: тест");
    expect(isEncryptedField(written.notes ?? null)).toBe(true);
    expect(hydratePatientForRead(written).notes).toBe("v1: тест");
  });

  it("left in plain text by the old code still reads as text", () => {
    const row = { id: "p1", clinicId: "c1", notes: "v1: первичный, v2: повтор" };
    expect(hydratePatientForRead(row).notes).toBe("v1: первичный, v2: повтор");
    expect(reported).toEqual([]);
  });
});

describe("a ciphertext that will not open", () => {
  function damaged(): string {
    const ct = encryptField("секрет");
    // Same envelope shape, a wrong tag: decryption fails authentication.
    const parts = ct.split(":");
    parts[2] = Buffer.alloc(16, 7).toString("base64");
    return parts.join(":");
  }

  it("reads as an empty field instead of throwing, and is reported once", () => {
    const bad = damaged();
    const rows = [
      { id: "p1", clinicId: "c1", passport: bad, notes: "ok" },
      { id: "p2", clinicId: "c1", passport: null, notes: encryptField("заметка") },
    ];
    const out = hydratePatientListForRead(rows);
    expect(out[0]!.passport).toBeNull();
    expect(out[0]!.notes).toBe("ok");
    expect(out[1]!.notes).toBe("заметка");
    // A second read within the hour does not report again.
    hydratePatientForRead(rows[0]!);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({
      entityType: "Patient",
      entityId: "p1",
      clinicId: "c1",
      field: "passport",
      versionPrefix: "v1",
    });
    expect(JSON.stringify(reported)).not.toContain("секрет");
  });

  it("an unknown key version (a retired key) is handled the same way", () => {
    const ct = encryptField("x");
    __setKeyForTests({ active: "v2", keys: { v2: randomBytes(32) } });
    expect(hydratePatientForRead({ id: "p9", notes: ct }).notes).toBeNull();
    expect(reported[0]).toMatchObject({ field: "notes", versionPrefix: "v1" });
  });

  it("the case, prescription and clinical-note readers never throw either", () => {
    const bad = damaged();
    expect(hydrateMedicalCaseForRead({ id: "m1", soapDraft: bad }).soapDraft).toBeNull();
    expect(hydratePrescriptionForRead({ id: "rx1", notes: bad }).notes).toBeNull();
    expect(readClinicalNoteBody(bad, { patientId: "p1" })).toBe("");
    expect(reported.map((r) => r.entityType).sort()).toEqual([
      "MedicalCase",
      "PatientClinicalNote",
      "Prescription",
    ]);
  });
});
