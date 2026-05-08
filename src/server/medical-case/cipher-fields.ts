/**
 * Phase 17 Wave 4 — MedicalCase encryption boundary.
 *
 * Encrypted at rest:
 *   - `soapDraft` — voice-transcribed SOAP markdown that the doctor edits.
 *     Free-form clinical text — the highest-PHI column on a case row.
 *
 * NOT encrypted (could be later — out of scope here):
 *   - `primaryComplaint`, `diagnosisText`, `notes` — Wave 4 keeps the encrypt
 *     list tight (per roadmap). If the clinic's compliance team upgrades the
 *     list, extend this helper and run the backfill script with the new column.
 *
 * `soapDraft` is plain markdown today; we never JSON.stringify it. The
 * roadmap anticipates the SOAP eventually being a structured JSON object —
 * when that happens, callers will JSON.stringify on write and JSON.parse on
 * read; the cipher boundary itself is bytes-in / bytes-out and won't care.
 */
import {
  decryptField,
  encryptField,
  isEncryptedField,
} from "@/server/crypto/field-cipher";

export type MedicalCaseCipherInput = {
  soapDraft?: string | null | undefined;
};

export type MedicalCaseCipherRow = {
  soapDraft?: string | null;
};

export function serializeMedicalCaseForWrite<T extends MedicalCaseCipherInput>(
  input: T,
): T {
  const out: Record<string, unknown> = { ...input };
  if ("soapDraft" in input) {
    out.soapDraft = encryptIfPresent(input.soapDraft ?? null);
  }
  return out as T;
}

export function hydrateMedicalCaseForRead<T extends MedicalCaseCipherRow>(
  row: T,
): T {
  if (!row || typeof row !== "object") return row;
  const out: Record<string, unknown> = { ...row };
  if ("soapDraft" in row) {
    out.soapDraft = decryptIfEncrypted(row.soapDraft ?? null);
  }
  return out as T;
}

export function hydrateMedicalCaseListForRead<T extends MedicalCaseCipherRow>(
  rows: T[],
): T[] {
  return rows.map((r) => hydrateMedicalCaseForRead(r));
}

function encryptIfPresent(value: string | null): string | null {
  if (value === null || value === undefined) return null;
  if (value === "") return "";
  if (isEncryptedField(value)) return value;
  return encryptField(value);
}

function decryptIfEncrypted(value: string | null): string | null {
  if (value === null || value === undefined) return null;
  if (!isEncryptedField(value)) return value;
  return decryptField(value);
}
