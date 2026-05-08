/**
 * Phase 17 Wave 4 — backfill script for app-level PII encryption.
 *
 * Walks every row of the encrypted-fields list and re-writes plaintext values
 * as `v<active>:…` ciphertext under the active FIELD_ENCRYPTION_KEY. Already-
 * encrypted rows are skipped via `isEncryptedField` — re-running is safe and
 * idempotent.
 *
 * Tables / columns covered:
 *   - Patient       → passport, notes
 *   - MedicalCase   → soapDraft
 *   - Prescription  → notes
 *
 * Strategy:
 *   - Cursor pagination by `id` to avoid OFFSET drift on a moving table.
 *   - Batch size 200; each batch re-encrypts in-memory then writes inside a
 *     single `prisma.$transaction` so a crash mid-batch doesn't leave half
 *     the rows under the new format.
 *   - Per-table progress counters: `total scanned`, `already encrypted`,
 *     `encrypted in this run`, `skipped (null/empty)`, `errors`.
 *
 * Run:
 *   FIELD_ENCRYPTION_KEY=$(openssl rand -base64 32) \
 *   DATABASE_URL=… \
 *   tsx scripts/encrypt-existing-pii.ts
 *
 * `--dry-run` prints what *would* be written without touching the DB.
 * `--table=patient` (or `medical_case`, `prescription`) limits to one table.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  encryptField,
  getActiveKeyVersion,
  isEncryptedField,
} from "../src/server/crypto/field-cipher";

const BATCH = 200;

type TableKey = "patient" | "medical_case" | "prescription";

interface Stats {
  scanned: number;
  alreadyEncrypted: number;
  encrypted: number;
  skippedNull: number;
  errors: number;
}

function newStats(): Stats {
  return {
    scanned: 0,
    alreadyEncrypted: 0,
    encrypted: 0,
    skippedNull: 0,
    errors: 0,
  };
}

function reencryptValue(
  value: string | null,
  stats: Stats,
): { write: boolean; next: string | null } {
  if (value === null || value === undefined) {
    stats.skippedNull++;
    return { write: false, next: null };
  }
  if (value === "") {
    // Empty string: treat as plaintext-empty and leave alone (encrypting "" is
    // a waste of an IV and the decrypt path tolerates it).
    stats.skippedNull++;
    return { write: false, next: "" };
  }
  if (isEncryptedField(value)) {
    stats.alreadyEncrypted++;
    return { write: false, next: value };
  }
  stats.encrypted++;
  return { write: true, next: encryptField(value) };
}

async function backfillPatient(
  prisma: PrismaClient,
  dryRun: boolean,
): Promise<Stats> {
  const stats = newStats();
  let cursor: string | undefined = undefined;
  // We have to read both columns at once because we have to detect which one
  // (or both) need re-encrypting per row.
  for (;;) {
    const rows: { id: string; passport: string | null; notes: string | null }[] =
      await prisma.patient.findMany({
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
        select: { id: true, passport: true, notes: true },
      });
    if (rows.length === 0) break;
    stats.scanned += rows.length;

    const updates: { id: string; passport?: string | null; notes?: string | null }[] = [];
    for (const r of rows) {
      const passport = reencryptValue(r.passport, stats);
      const notes = reencryptValue(r.notes, stats);
      if (passport.write || notes.write) {
        const data: { id: string; passport?: string | null; notes?: string | null } = {
          id: r.id,
        };
        if (passport.write) data.passport = passport.next;
        if (notes.write) data.notes = notes.next;
        updates.push(data);
      }
    }

    if (updates.length > 0 && !dryRun) {
      try {
        await prisma.$transaction(
          updates.map((u) => {
            const { id, ...rest } = u;
            return prisma.patient.update({
              where: { id },
              data: rest as never,
            });
          }),
        );
      } catch (e) {
        stats.errors += updates.length;
        console.error("[backfill:patient] batch failed", e);
      }
    }

    cursor = rows[rows.length - 1]!.id;
    process.stdout.write(
      `[patient] scanned=${stats.scanned} encrypted=${stats.encrypted} already=${stats.alreadyEncrypted} skipped=${stats.skippedNull}\r`,
    );
  }
  process.stdout.write("\n");
  return stats;
}

async function backfillMedicalCase(
  prisma: PrismaClient,
  dryRun: boolean,
): Promise<Stats> {
  const stats = newStats();
  let cursor: string | undefined = undefined;
  for (;;) {
    const rows: { id: string; soapDraft: string | null }[] =
      await prisma.medicalCase.findMany({
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
        select: { id: true, soapDraft: true },
      });
    if (rows.length === 0) break;
    stats.scanned += rows.length;

    const updates: { id: string; soapDraft: string | null }[] = [];
    for (const r of rows) {
      const v = reencryptValue(r.soapDraft, stats);
      if (v.write) updates.push({ id: r.id, soapDraft: v.next });
    }

    if (updates.length > 0 && !dryRun) {
      try {
        await prisma.$transaction(
          updates.map((u) =>
            prisma.medicalCase.update({
              where: { id: u.id },
              data: { soapDraft: u.soapDraft } as never,
            }),
          ),
        );
      } catch (e) {
        stats.errors += updates.length;
        console.error("[backfill:medical_case] batch failed", e);
      }
    }

    cursor = rows[rows.length - 1]!.id;
    process.stdout.write(
      `[medical_case] scanned=${stats.scanned} encrypted=${stats.encrypted} already=${stats.alreadyEncrypted} skipped=${stats.skippedNull}\r`,
    );
  }
  process.stdout.write("\n");
  return stats;
}

async function backfillPrescription(
  prisma: PrismaClient,
  dryRun: boolean,
): Promise<Stats> {
  const stats = newStats();
  let cursor: string | undefined = undefined;
  for (;;) {
    const rows: { id: string; notes: string | null }[] =
      await prisma.prescription.findMany({
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
        select: { id: true, notes: true },
      });
    if (rows.length === 0) break;
    stats.scanned += rows.length;

    const updates: { id: string; notes: string | null }[] = [];
    for (const r of rows) {
      const v = reencryptValue(r.notes, stats);
      if (v.write) updates.push({ id: r.id, notes: v.next });
    }

    if (updates.length > 0 && !dryRun) {
      try {
        await prisma.$transaction(
          updates.map((u) =>
            prisma.prescription.update({
              where: { id: u.id },
              data: { notes: u.notes } as never,
            }),
          ),
        );
      } catch (e) {
        stats.errors += updates.length;
        console.error("[backfill:prescription] batch failed", e);
      }
    }

    cursor = rows[rows.length - 1]!.id;
    process.stdout.write(
      `[prescription] scanned=${stats.scanned} encrypted=${stats.encrypted} already=${stats.alreadyEncrypted} skipped=${stats.skippedNull}\r`,
    );
  }
  process.stdout.write("\n");
  return stats;
}

function parseArgs(): { dryRun: boolean; only: TableKey | null } {
  const args = process.argv.slice(2);
  let dryRun = false;
  let only: TableKey | null = null;
  for (const a of args) {
    if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--table=")) {
      const v = a.slice("--table=".length);
      if (v === "patient" || v === "medical_case" || v === "prescription") {
        only = v;
      } else {
        throw new Error(`Unknown --table value: ${v}`);
      }
    }
  }
  return { dryRun, only };
}

async function main(): Promise<void> {
  const { dryRun, only } = parseArgs();
  const dburl = process.env.DATABASE_URL;
  if (!dburl) throw new Error("DATABASE_URL is required");
  const adapter = new PrismaPg({ connectionString: dburl });
  const prisma = new PrismaClient({ adapter });

  const active = getActiveKeyVersion();
  console.info(
    `[backfill] active key version=${active}, dryRun=${dryRun}, only=${only ?? "ALL"}`,
  );
  if (process.env.NODE_ENV !== "production" && !process.env.FIELD_ENCRYPTION_KEY) {
    console.warn(
      "[backfill] WARNING: no FIELD_ENCRYPTION_KEY set — running under the dev fallback. Production data backfill MUST set a real key.",
    );
  }

  const totals: Record<string, Stats> = {};
  if (!only || only === "patient") {
    console.info("[backfill] patient.passport + patient.notes");
    totals["patient"] = await backfillPatient(prisma, dryRun);
  }
  if (!only || only === "medical_case") {
    console.info("[backfill] medical_case.soapDraft");
    totals["medical_case"] = await backfillMedicalCase(prisma, dryRun);
  }
  if (!only || only === "prescription") {
    console.info("[backfill] prescription.notes");
    totals["prescription"] = await backfillPrescription(prisma, dryRun);
  }

  console.info("");
  console.info("[backfill] === Summary ===");
  for (const [name, s] of Object.entries(totals)) {
    console.info(
      `  ${name.padEnd(14)} scanned=${s.scanned}  encrypted=${s.encrypted}  alreadyEncrypted=${s.alreadyEncrypted}  skipped(null/empty)=${s.skippedNull}  errors=${s.errors}`,
    );
  }
  if (dryRun) {
    console.info("[backfill] DRY RUN — no rows written.");
  }
  await prisma.$disconnect();
}

// Allow `tsx scripts/encrypt-existing-pii.ts` as the entry point. Also exported
// pieces (reencryptValue) are used by the unit test for the pure-function path.
if (process.argv[1] && process.argv[1].includes("encrypt-existing-pii")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { reencryptValue };
