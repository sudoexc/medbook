/**
 * Audit SEC-09 data fix: patient identity already written into AuditLog.meta.
 *
 * Until this release the audit log kept, in plain text:
 *   - `patient.create` / `patient.delete`: the whole decrypted card
 *     (name, phone, passport, notes, address...);
 *   - `patient.update`: the before/after of every changed column, the
 *     decrypted passport and notes included;
 *   - `medical_case.create` / `medical_case.update`: the patient's name and
 *     phone (from the case's `patient` include) and the decrypted SOAP draft;
 *   - PATIENT_ANONYMIZED / PATIENT_HARD_DELETED: a «forensic» copy of the
 *     erased person (name, phone, Telegram id, passport), so a DSAR erasure
 *     left them identifiable in «Настройки → Аудит».
 * The app now writes these rows in the new shape (identity columns by name
 * only). This script brings the old rows to the same shape:
 *
 *   1. For every DSAR row that still holds the snapshot: the person is
 *      redacted from the whole clinic's audit log (the same scrub a DSAR run
 *      now does), then the snapshot is replaced by the names of the fields.
 *   2. Every old-shape patient / case row above is rewritten: identity
 *      columns and the SOAP draft by name, other columns keep their values,
 *      relation includes dropped.
 *
 * Nothing else in the row changes (action, actor, time, entity).
 *
 * WHEN: any time after the deploy that ships SEC-09.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-sec09-audit-pii.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-sec09-audit-pii.ts
 *
 * Idempotent: rows already in the new shape are recognised and skipped, and
 * the scrub leaves already redacted values alone.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  CASE_NAME_ONLY_FIELDS,
  PATIENT_PII_FIELDS,
  redactedDiff,
  redactedSnapshot,
} from "../src/server/audit/patient-audit-meta";
import {
  scrubPatientFromAuditLog,
  type PatientIdentity,
} from "../src/server/dsar/audit-scrub";

type Row = Record<string, unknown>;

const isObject = (v: unknown): v is Row =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const DSAR_ACTIONS = ["PATIENT_ANONYMIZED", "PATIENT_HARD_DELETED"] as const;

const REWRITTEN_ACTIONS = [
  "patient.create",
  "patient.update",
  "patient.delete",
  "medical_case.create",
  "medical_case.update",
] as const;

/**
 * The new-shape meta for an old-shape row, or null when the row is already
 * in the new shape (or not one this fix knows).
 */
export function rewriteAuditMeta(action: string, meta: unknown): Row | null {
  if (!isObject(meta)) return null;
  const nameOnly = action.startsWith("patient.")
    ? PATIENT_PII_FIELDS
    : CASE_NAME_ONLY_FIELDS;
  switch (action) {
    case "patient.create":
    case "medical_case.create":
      return isObject(meta.after) && !("card" in meta)
        ? { ...redactedSnapshot(meta.after, nameOnly) }
        : null;
    case "patient.delete":
      return isObject(meta.before) && !("card" in meta)
        ? { ...redactedSnapshot(meta.before, nameOnly) }
        : null;
    case "patient.update":
    case "medical_case.update": {
      if (Array.isArray(meta.changed)) return null;
      if (!isObject(meta.before) || !isObject(meta.after)) return null;
      const { before: _b, after: _a, ...rest } = meta;
      return { ...redactedDiff(meta.before, meta.after, nameOnly), ...rest };
    }
    default:
      return null;
  }
}

/** The erased person from a DSAR row's old «forensic» snapshot, or null. */
export function dsarSnapshotIdentity(
  entityId: string | null,
  meta: unknown,
): PatientIdentity | null {
  if (!entityId || !isObject(meta) || !isObject(meta.before)) return null;
  const s = meta.before;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    id: entityId,
    fullName: str(s.fullName),
    phone: str(s.phone),
    phoneNormalized: str(s.phoneNormalized),
    passport: str(s.passport),
    telegramId: str(s.telegramId),
    telegramUsername: str(s.telegramUsername),
  };
}

export type Sec09Summary = {
  dsarRows: number;
  scrubbedRows: number;
  rewrittenRows: number;
};

export async function fixSec09AuditPii(
  db: PrismaClient,
  apply: boolean,
  log: (line: string) => void = console.log,
): Promise<Sec09Summary> {
  const summary: Sec09Summary = { dsarRows: 0, scrubbedRows: 0, rewrittenRows: 0 };

  log(`┌─ ${apply ? "APPLY" : "DRY RUN"}`);

  // 1. DSAR rows first: their snapshot is the only record of whom to scrub.
  const dsar = await db.auditLog.findMany({
    where: { action: { in: [...DSAR_ACTIONS] }, entityType: "Patient" },
    select: { id: true, clinicId: true, entityId: true, meta: true },
  });
  for (const row of dsar) {
    const identity = dsarSnapshotIdentity(row.entityId, row.meta);
    if (!identity || !row.clinicId) continue;
    summary.dsarRows += 1;
    const meta = row.meta as Row;
    const erased = Object.keys(meta.before as Row).filter(
      (k) => (meta.before as Row)[k] !== null && (meta.before as Row)[k] !== "",
    );
    log(`│ DSAR ${row.id} (patient ${row.entityId}): snapshot of ${erased.join(", ")}`);
    if (!apply) continue;
    summary.scrubbedRows += await scrubPatientFromAuditLog(
      db as never,
      row.clinicId,
      identity,
    );
    const { before: _before, ...rest } = meta;
    await db.auditLog.update({
      where: { id: row.id },
      data: { meta: { ...rest, erased } as never },
    });
  }

  // 2. Old-shape patient and case rows, in pages by id.
  let cursor: string | undefined;
  for (;;) {
    const page = await db.auditLog.findMany({
      where: { action: { in: [...REWRITTEN_ACTIONS] } },
      select: { id: true, action: true, meta: true },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1]!.id;
    for (const row of page) {
      const next = rewriteAuditMeta(row.action, row.meta);
      if (!next) continue;
      summary.rewrittenRows += 1;
      if (!apply) continue;
      await db.auditLog.update({
        where: { id: row.id },
        data: { meta: next as never },
      });
    }
  }
  log(`│ old-shape patient / case rows: ${summary.rewrittenRows}`);

  if (!apply) {
    log(
      `└─ DSAR rows: ${summary.dsarRows}; nothing written; run again with APPLY=1`,
    );
    return summary;
  }
  log(
    `└─ DSAR rows: ${summary.dsarRows} (other rows scrubbed: ${summary.scrubbedRows}); ` +
      `rows rewritten: ${summary.rewrittenRows}`,
  );
  return summary;
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
  });
  try {
    await fixSec09AuditPii(prisma, process.env.APPLY === "1");
  } finally {
    await prisma.$disconnect();
  }
}

// `tsx scripts/fix-sec09-audit-pii.ts` is the entry point; the unit test
// imports the helpers without touching a database.
if (process.argv[1]?.includes("fix-sec09-audit-pii")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
