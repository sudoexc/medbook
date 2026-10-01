/**
 * Audit G1-03 data fix: Mini App audit rows with no clinic and no actor.
 *
 * The Mini App routes wrote their audit rows through `audit()`, which finds
 * the clinic in a TENANT context or a staff session. The Mini App has
 * neither, so every patient's deletion and export request, upload, message,
 * consent change, reminder answer and low rating went in with
 * `clinicId = NULL` and no actor, and the clinic's journal never showed
 * them. The code now writes them through `auditMiniApp`; this script gives
 * the old rows their clinic, and their actor where the row says who acted
 * (`patient:<id>`, role PATIENT, surface MINIAPP, like the outbox rows of
 * the same surface). See src/server/audit/miniapp-audit-backfill.ts for the
 * rules.
 *
 * Only rows of the Mini App actions with `clinicId` AND `actorId` NULL are
 * read: a staff action of the same name always has its actor. A row whose
 * clinic cannot be told (patient hard-deleted, no clinic in its meta) is
 * listed and left alone.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-g1-03-miniapp-audit-clinic.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-g1-03-miniapp-audit-clinic.ts
 *
 * Idempotent: a repaired row has its clinic and is not read again.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  MINIAPP_AUDIT_ACTIONS,
  planMiniAppAuditFix,
  rowPatientId,
  type OrphanAuditRow,
} from "../src/server/audit/miniapp-audit-backfill";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";
const BATCH = 500;

async function main() {
  const rows: OrphanAuditRow[] = await prisma.auditLog.findMany({
    where: {
      clinicId: null,
      actorId: null,
      action: { in: [...MINIAPP_AUDIT_ACTIONS] },
    },
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      meta: true,
      actorLabel: true,
      surface: true,
    },
    orderBy: { createdAt: "asc" },
  });
  console.log(`[g1-03] ${rows.length} Mini App audit rows without a clinic`);
  if (rows.length === 0) return;

  const clinics = await prisma.clinic.findMany({ select: { id: true } });
  const knownClinicIds = new Set(clinics.map((c) => c.id));

  const patientIds = [
    ...new Set(rows.map(rowPatientId).filter((id): id is string => id !== null)),
  ];
  const patientClinic = new Map<string, string>();
  for (let i = 0; i < patientIds.length; i += BATCH) {
    const found = await prisma.patient.findMany({
      where: { id: { in: patientIds.slice(i, i + BATCH) } },
      select: { id: true, clinicId: true },
    });
    for (const p of found) patientClinic.set(p.id, p.clinicId);
  }

  const byAction = new Map<string, { fix: number; actor: number; skip: number }>();
  const fixes = [];
  const skipped: OrphanAuditRow[] = [];
  for (const row of rows) {
    const tally = byAction.get(row.action) ?? { fix: 0, actor: 0, skip: 0 };
    byAction.set(row.action, tally);
    const fix = planMiniAppAuditFix(row, knownClinicIds, patientClinic);
    if (!fix) {
      tally.skip += 1;
      skipped.push(row);
      continue;
    }
    tally.fix += 1;
    if (fix.actor) tally.actor += 1;
    fixes.push(fix);
  }

  for (const [action, t] of byAction) {
    console.log(
      `  ${action}: ${t.fix} to fix (${t.actor} with an actor), ${t.skip} without a clinic`,
    );
  }
  for (const row of skipped.slice(0, 20)) {
    console.log(`  left alone: ${row.id} ${row.action} ${row.entityType}:${row.entityId ?? "-"}`);
  }

  if (!APPLY) {
    console.log("[g1-03] DRY RUN: nothing written. Re-run with APPLY=1 to write.");
    return;
  }

  let written = 0;
  for (let i = 0; i < fixes.length; i += BATCH) {
    const slice = fixes.slice(i, i + BATCH);
    await prisma.$transaction(
      slice.map((fix) =>
        prisma.auditLog.updateMany({
          // Still orphaned: a concurrent run or a later write is not redone.
          where: { id: fix.id, clinicId: null },
          data: {
            clinicId: fix.clinicId,
            ...(fix.actor ? { actorRole: fix.actor.role, actorLabel: fix.actor.label } : {}),
            ...(fix.surface ? { surface: fix.surface } : {}),
          },
        }),
      ),
    );
    written += slice.length;
  }
  console.log(`[g1-03] APPLIED: ${written} rows now carry their clinic`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
