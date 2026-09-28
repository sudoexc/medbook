/**
 * Erase a patient's identity from the audit log (audit SEC-09).
 *
 * A DSAR anonymization scrubbed the Patient row, yet «Настройки → Аудит»
 * still named the person: every `patient.update` diff, the `patient.create`
 * snapshot, a case created with the patient's name and phone in its meta,
 * and the anonymization row itself (a «forensic» copy of name, phone,
 * Telegram id and decrypted passport). The audit trail stays (who did what,
 * when); only the values that identify the person are replaced.
 *
 * Two rules, applied to a JSON copy of each row's meta:
 *   - any string that contains one of the person's identifiers (name,
 *     phone, passport, Telegram id or username) is replaced, wherever it
 *     sits, in any row of the clinic;
 *   - in the patient's own rows (entityId = the patient), every value under
 *     an identity key (`PATIENT_PII_FIELDS`: address, birth date, notes...)
 *     is replaced too, even when it matches nothing.
 *
 * Identifiers shorter than five characters are not searched for: «Али»
 * would erase unrelated text across the clinic's log. Such a value in the
 * patient's own rows still goes under the second rule.
 */
import type { prisma } from "@/lib/prisma";
import { PATIENT_PII_FIELDS } from "@/server/audit/patient-audit-meta";

export const REDACTED = "[redacted]";

const MIN_TERM_LENGTH = 5;

export type PatientIdentity = {
  id: string;
  fullName: string | null;
  phone: string | null;
  phoneNormalized: string | null;
  passport: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
};

/** The identifiers worth searching for, lower-cased, longest first. */
export function identityTerms(p: PatientIdentity): string[] {
  const raw = [
    p.fullName,
    p.phone,
    // Stubs (`tg:…`, `contact:…`, `deleted:…`) are not a number anyone has.
    p.phoneNormalized && /^\+?\d+$/.test(p.phoneNormalized)
      ? p.phoneNormalized
      : null,
    p.passport,
    p.telegramId,
    p.telegramUsername,
  ];
  const terms = new Set<string>();
  for (const v of raw) {
    const t = v?.trim().toLowerCase();
    if (t && t.length >= MIN_TERM_LENGTH) terms.add(t);
  }
  return Array.from(terms).sort((a, b) => b.length - a.length);
}

/**
 * A redacted copy of `meta` and whether anything changed. `ownRow`: the
 * audit row is about the patient themselves (entityId = patient id).
 */
export function redactAuditMeta(
  meta: unknown,
  terms: readonly string[],
  opts: { ownRow: boolean },
): { meta: unknown; changed: boolean } {
  let changed = false;
  const walk = (value: unknown, key: string | null): unknown => {
    if (
      opts.ownRow &&
      key !== null &&
      PATIENT_PII_FIELDS.has(key) &&
      value !== null &&
      value !== undefined &&
      value !== "" &&
      value !== REDACTED
    ) {
      changed = true;
      return REDACTED;
    }
    if (typeof value === "string") {
      const lower = value.toLowerCase();
      if (terms.some((t) => lower.includes(t))) {
        changed = true;
        return REDACTED;
      }
      return value;
    }
    if (Array.isArray(value)) return value.map((v) => walk(v, null));
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v, k);
      return out;
    }
    return value;
  };
  const next = walk(meta, null);
  return { meta: changed ? next : meta, changed };
}

/** Escape `%`, `_` and `\` for a LIKE pattern. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

type AuditRow = {
  id: string;
  entityId: string | null;
  meta: unknown;
};

export type AuditScrubDb = Pick<typeof prisma, "$queryRaw" | "auditLog">;

/**
 * Redact the patient's identity from every audit row of the clinic that is
 * about them or mentions them. Returns how many rows were rewritten.
 * Idempotent: a second run finds the rows but changes nothing.
 */
export async function scrubPatientFromAuditLog(
  db: AuditScrubDb,
  clinicId: string,
  identity: PatientIdentity,
): Promise<number> {
  const terms = identityTerms(identity);
  const patterns = [identity.id, ...terms].map((t) => `%${likeEscape(t)}%`);
  const rows = await db.$queryRaw<AuditRow[]>`
    SELECT "id", "entityId", "meta" FROM "AuditLog"
    WHERE "clinicId" = ${clinicId}
      AND "meta" IS NOT NULL
      AND ("entityId" = ${identity.id} OR "meta"::text ILIKE ANY (${patterns}::text[]))`;
  let rewritten = 0;
  for (const row of rows) {
    const { meta, changed } = redactAuditMeta(row.meta, terms, {
      ownRow: row.entityId === identity.id,
    });
    if (!changed) continue;
    await db.auditLog.update({
      where: { id: row.id },
      data: { meta: meta as never },
    });
    rewritten += 1;
  }
  return rewritten;
}
