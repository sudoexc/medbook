/**
 * Phase 17 Wave 4 — key-rotation script.
 *
 * Re-encrypts every PHI cell whose stored prefix doesn't match the active
 * `FIELD_ENCRYPTION_KEY_V<n>`. Decrypt path picks the right key by version
 * tag, encrypt path always writes under the active version — so this script
 * is just "find rows where prefix != active, decrypt+re-encrypt".
 *
 * The active version is derived by `getActiveKeyVersion()`; the OLD key
 * MUST also be present in the env (as `FIELD_ENCRYPTION_KEY_V<old>`) when
 * this script runs, otherwise the decrypt step throws.
 *
 * Run order during a rotation:
 *   1. Add `FIELD_ENCRYPTION_KEY_V<new>=$(openssl rand -base64 32)` alongside
 *      the existing v<n>; keep BOTH keys live during the rotation window.
 *   2. Restart workers + web. New writes now go out as `v<new>:…`.
 *   3. `tsx scripts/rotate-encryption-key.ts` — sweeps existing rows.
 *   4. After confirming "rows under old version" is 0 in
 *      /admin/encryption-health, drop `FIELD_ENCRYPTION_KEY_V<old>` and
 *      restart again.
 *
 * Idempotent: rows already at the active version are skipped (they're the
 * common case if the script is re-run).
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  decryptField,
  encryptField,
  getActiveKeyVersion,
  isEncryptedField,
  readVersionPrefix,
} from "../src/server/crypto/field-cipher";

const BATCH = 200;

interface RotStats {
  scanned: number;
  rotated: number;
  alreadyActive: number;
  plaintext: number;
  errors: number;
}

function blank(): RotStats {
  return {
    scanned: 0,
    rotated: 0,
    alreadyActive: 0,
    plaintext: 0,
    errors: 0,
  };
}

function maybeRotate(
  value: string | null,
  active: string,
  stats: RotStats,
): { write: boolean; next: string | null } {
  if (value === null || value === undefined || value === "") {
    return { write: false, next: value ?? null };
  }
  if (!isEncryptedField(value)) {
    // Plaintext leaks — backfill should have run first. Surface but don't
    // touch (the backfill script is the right place for this).
    stats.plaintext++;
    return { write: false, next: value };
  }
  const prefix = readVersionPrefix(value);
  if (prefix === active) {
    stats.alreadyActive++;
    return { write: false, next: value };
  }
  // Rotate: decrypt under the old key (resolved via the embedded prefix),
  // re-encrypt under the active key.
  try {
    const plain = decryptField(value);
    if (plain === null) return { write: false, next: value };
    const next = encryptField(plain);
    stats.rotated++;
    return { write: true, next };
  } catch (e) {
    stats.errors++;
    console.error(
      `[rotate] decrypt failed (prefix=${prefix}, active=${active}); leaving row alone:`,
      e,
    );
    return { write: false, next: value };
  }
}

async function rotatePatient(
  prisma: PrismaClient,
  active: string,
  dryRun: boolean,
): Promise<RotStats> {
  const stats = blank();
  let cursor: string | undefined = undefined;
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
      const passport = maybeRotate(r.passport, active, stats);
      const notes = maybeRotate(r.notes, active, stats);
      if (passport.write || notes.write) {
        const data: { id: string; passport?: string | null; notes?: string | null } = { id: r.id };
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
        console.error("[rotate:patient] batch failed", e);
      }
    }

    cursor = rows[rows.length - 1]!.id;
    process.stdout.write(
      `[patient] scanned=${stats.scanned} rotated=${stats.rotated} alreadyActive=${stats.alreadyActive} plaintext=${stats.plaintext}\r`,
    );
  }
  process.stdout.write("\n");
  return stats;
}

async function rotateMedicalCase(
  prisma: PrismaClient,
  active: string,
  dryRun: boolean,
): Promise<RotStats> {
  const stats = blank();
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
      const v = maybeRotate(r.soapDraft, active, stats);
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
        console.error("[rotate:medical_case] batch failed", e);
      }
    }

    cursor = rows[rows.length - 1]!.id;
    process.stdout.write(
      `[medical_case] scanned=${stats.scanned} rotated=${stats.rotated} alreadyActive=${stats.alreadyActive}\r`,
    );
  }
  process.stdout.write("\n");
  return stats;
}

async function rotatePrescription(
  prisma: PrismaClient,
  active: string,
  dryRun: boolean,
): Promise<RotStats> {
  const stats = blank();
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
      const v = maybeRotate(r.notes, active, stats);
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
        console.error("[rotate:prescription] batch failed", e);
      }
    }

    cursor = rows[rows.length - 1]!.id;
    process.stdout.write(
      `[prescription] scanned=${stats.scanned} rotated=${stats.rotated} alreadyActive=${stats.alreadyActive}\r`,
    );
  }
  process.stdout.write("\n");
  return stats;
}

function parseArgs(): { dryRun: boolean } {
  const args = process.argv.slice(2);
  return { dryRun: args.includes("--dry-run") };
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs();
  const dburl = process.env.DATABASE_URL;
  if (!dburl) throw new Error("DATABASE_URL is required");
  const adapter = new PrismaPg({ connectionString: dburl });
  const prisma = new PrismaClient({ adapter });

  const active = getActiveKeyVersion();
  console.info(`[rotate] active key version=${active}, dryRun=${dryRun}`);

  const patientStats = await rotatePatient(prisma, active, dryRun);
  const caseStats = await rotateMedicalCase(prisma, active, dryRun);
  const rxStats = await rotatePrescription(prisma, active, dryRun);

  const lines = [
    ["patient", patientStats],
    ["medical_case", caseStats],
    ["prescription", rxStats],
  ] as const;

  console.info("");
  console.info("[rotate] === Summary ===");
  for (const [name, s] of lines) {
    console.info(
      `  ${name.padEnd(14)} scanned=${s.scanned}  rotated=${s.rotated}  alreadyActive=${s.alreadyActive}  plaintext=${s.plaintext}  errors=${s.errors}`,
    );
  }
  if (dryRun) console.info("[rotate] DRY RUN — no rows written.");
  await prisma.$disconnect();
}

if (process.argv[1] && process.argv[1].includes("rotate-encryption-key")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { maybeRotate };
