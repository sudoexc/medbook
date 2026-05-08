/**
 * Phase 17 Wave 4 — Patient PII serialise/deserialise boundary.
 *
 * Encrypted at rest:
 *   - `passport`  — UZ passport / JSHSHIR id, free-form short string.
 *   - `notes`     — free-text PII collected by reception / doctor.
 *
 * NOT encrypted (and intentionally so):
 *   - `fullName`, `phoneNormalized`, `email`, `telegramId`,
 *     `telegramUsername` — every CRM list / search / inbound webhook joins
 *     on these. Encrypting them would force a "blind index" (HMAC) layer
 *     that's a separate architecture decision (see runbook).
 *   - `birthDate`           — used by birthday cron.
 *   - `address`             — schema-only PII, used in lists where
 *     contains-search is occasionally desirable; if a clinic later requests
 *     it on the encrypt list we extend this helper.
 */
import {
  decryptField,
  encryptField,
  isEncryptedField,
} from "@/server/crypto/field-cipher";

/** The shape of fields this helper touches — keep narrow on purpose. */
export type PatientCipherInput = {
  passport?: string | null | undefined;
  notes?: string | null | undefined;
};

export type PatientCipherRow = {
  passport?: string | null;
  notes?: string | null;
};

/**
 * Wrap a partial Patient `data` payload (create or update) so the encrypted
 * fields hit the DB as ciphertext. Only fields explicitly present on the
 * input get touched — undefined keys stay undefined so partial updates don't
 * accidentally null out a column.
 *
 * If a value is already a valid `v<n>:…` ciphertext (e.g. caller is passing
 * something they fetched and didn't decrypt), we re-emit it as-is. This is
 * a defensive safeguard — no app code should be doing that, but it would
 * silently double-encrypt otherwise.
 */
export function serializePatientForWrite<T extends PatientCipherInput>(
  input: T,
): T {
  const out: Record<string, unknown> = { ...input };
  if ("passport" in input) {
    out.passport = encryptIfPresent(input.passport ?? null);
  }
  if ("notes" in input) {
    out.notes = encryptIfPresent(input.notes ?? null);
  }
  return out as T;
}

/**
 * Decrypt a Patient row read from the DB. Tolerates plaintext (legacy /
 * not-yet-backfilled) values to ease migration. Returns the same row shape
 * so callers can spread into a JSON response unchanged.
 */
export function hydratePatientForRead<T extends PatientCipherRow>(row: T): T {
  if (!row || typeof row !== "object") return row;
  const out: Record<string, unknown> = { ...row };
  if ("passport" in row) {
    out.passport = decryptIfEncrypted(row.passport ?? null);
  }
  if ("notes" in row) {
    out.notes = decryptIfEncrypted(row.notes ?? null);
  }
  return out as T;
}

/**
 * Convenience for list endpoints — accepts an array, applies the read
 * hydration row-by-row. Falsy rows are passed through untouched.
 */
export function hydratePatientListForRead<T extends PatientCipherRow>(
  rows: T[],
): T[] {
  return rows.map((r) => hydratePatientForRead(r));
}

function encryptIfPresent(value: string | null): string | null {
  if (value === null || value === undefined) return null;
  if (value === "") return ""; // empty string is meaningful — keep as-is, no need to encrypt the absence
  if (isEncryptedField(value)) return value;
  return encryptField(value);
}

function decryptIfEncrypted(value: string | null): string | null {
  if (value === null || value === undefined) return null;
  if (!isEncryptedField(value)) return value;
  return decryptField(value);
}
