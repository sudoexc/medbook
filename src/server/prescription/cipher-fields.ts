/**
 * Phase 17 Wave 4 — Prescription encryption boundary.
 *
 * Encrypted at rest:
 *   - `notes` — free-text doctor notes attached to a prescription.
 *
 * NOT encrypted (clinical metadata, not PII):
 *   - `drugName`, `dosage`, `schedule`, `status`, `remindersEnabled`.
 */
import { encryptField, isEncryptedField } from "@/server/crypto/field-cipher";
import { decryptOrReport, rowRef } from "@/server/crypto/decrypt-failure";

export type PrescriptionCipherInput = {
  notes?: string | null | undefined;
};

export type PrescriptionCipherRow = {
  notes?: string | null;
};

export function serializePrescriptionForWrite<
  T extends PrescriptionCipherInput,
>(input: T): T {
  const out: Record<string, unknown> = { ...input };
  if ("notes" in input) {
    out.notes = encryptIfPresent(input.notes ?? null);
  }
  return out as T;
}

export function hydratePrescriptionForRead<T extends PrescriptionCipherRow>(
  row: T,
): T {
  if (!row || typeof row !== "object") return row;
  const out: Record<string, unknown> = { ...row };
  if ("notes" in row) {
    // Never throws (audit G1-08): a damaged envelope reads as null.
    out.notes = decryptOrReport(row.notes, rowRef(row, "Prescription", "notes"));
  }
  return out as T;
}

export function hydratePrescriptionListForRead<
  T extends PrescriptionCipherRow,
>(rows: T[]): T[] {
  return rows.map((r) => hydratePrescriptionForRead(r));
}

function encryptIfPresent(value: string | null): string | null {
  if (value === null || value === undefined) return null;
  if (value === "") return "";
  if (isEncryptedField(value)) return value;
  return encryptField(value);
}
