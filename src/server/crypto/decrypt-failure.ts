/**
 * A ciphertext that will not open must cost one field, not the page
 * (audit G1-08).
 *
 * `decryptField` throws on a damaged envelope, an unknown key version or a
 * tag mismatch. The read boundaries (`hydratePatientForRead` and its case /
 * prescription / clinical-note siblings) used to let that throw, so one bad
 * row turned GET /api/crm/patients and the patient card into a 500 for the
 * whole clinic, and the ENCRYPTION_DECRYPT_FAILED event the cipher's header
 * promised was never written by anyone. Now the boundary reads the field as
 * empty and the failure lands in the audit log once per row and field an
 * hour: the entity, the field and the key version, never any plaintext.
 */
import { AUDIT_ACTION } from "@/lib/audit-actions";

import { decryptField, isEncryptedField, readVersionPrefix } from "./field-cipher";

export type DecryptRef = {
  /** Source table: `Patient`, `MedicalCase`, `Prescription`, ... */
  entityType: string;
  entityId?: string | null;
  clinicId?: string | null;
  field: string;
};

export type DecryptFailure = DecryptRef & {
  versionPrefix: string | null;
  errorMessage: string;
};

type Reporter = (failure: DecryptFailure) => void;

const REPORT_EVERY_MS = 60 * 60 * 1000;
const MAX_REMEMBERED = 2000;
const lastReported = new Map<string, number>();

async function writeAuditRow(failure: DecryptFailure): Promise<void> {
  try {
    const [{ prisma }, { runWithTenant }] = await Promise.all([
      import("@/lib/prisma"),
      import("@/lib/tenant-context"),
    ]);
    await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.auditLog.create({
        data: {
          clinicId: failure.clinicId ?? null,
          actorId: null,
          actorRole: null,
          actorLabel: "system",
          action: AUDIT_ACTION.ENCRYPTION_DECRYPT_FAILED,
          entityType: failure.entityType,
          entityId: failure.entityId ?? null,
          meta: {
            field: failure.field,
            versionPrefix: failure.versionPrefix,
            errorMessage: failure.errorMessage.slice(0, 300),
          },
        },
      }),
    );
  } catch (err) {
    console.error("[field-cipher] ENCRYPTION_DECRYPT_FAILED audit failed", err);
  }
}

let reporter: Reporter = (failure) => {
  void writeAuditRow(failure);
};

/** Test-only: capture failures instead of writing audit rows. */
export function __setDecryptFailureReporterForTests(fn: Reporter | null): void {
  reporter = fn ?? ((failure) => void writeAuditRow(failure));
  lastReported.clear();
}

function report(failure: DecryptFailure): void {
  const key = `${failure.entityType}:${failure.entityId ?? "?"}:${failure.field}`;
  const now = Date.now();
  const last = lastReported.get(key);
  if (last !== undefined && now - last < REPORT_EVERY_MS) return;
  if (lastReported.size >= MAX_REMEMBERED) lastReported.clear();
  lastReported.set(key, now);
  console.error(
    `[field-cipher] cannot decrypt ${failure.entityType}.${failure.field} (${failure.entityId ?? "?"}): ${failure.errorMessage}`,
  );
  try {
    reporter(failure);
  } catch {
    // Telemetry never breaks a read.
  }
}

/**
 * Read one stored value: plaintext passes through (legacy rows), our
 * envelope is decrypted, and an envelope that will not open reads as null
 * and is reported. Never throws.
 */
export function decryptOrReport(
  value: string | null | undefined,
  ref: DecryptRef,
): string | null {
  if (value === null || value === undefined) return null;
  if (!isEncryptedField(value)) return value;
  try {
    return decryptField(value);
  } catch (err) {
    report({
      ...ref,
      versionPrefix: readVersionPrefix(value),
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** `id` / `clinicId` of a row when the caller selected them. */
export function rowRef(
  row: unknown,
  entityType: string,
  field: string,
): DecryptRef {
  const r = (row ?? {}) as { id?: unknown; clinicId?: unknown };
  return {
    entityType,
    field,
    entityId: typeof r.id === "string" ? r.id : null,
    clinicId: typeof r.clinicId === "string" ? r.clinicId : null,
  };
}
