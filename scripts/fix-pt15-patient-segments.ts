/**
 * Audit PT-15 data fix: recompute `Patient.segment` by the rule of
 * `src/lib/patients/segment-rules.ts`.
 *
 * The segment was written once, NEW at registration, and never again, so
 * every patient reads «Новый». The worker (`patient-segments`) now runs the
 * rule every 6 hours and once at its start; this script shows what the first
 * pass will change and can apply it without waiting for the worker.
 *
 * What it changes: `segment` of live (not deleted) patients whose stored
 * value differs from the rule. VIP is never touched. Nothing else.
 *
 * It reads `visitsCount` / `lastVisitAt`. Run
 * scripts/backfill-patient-visit-stats.ts first if it has not been run since
 * the AP-07 / PT-06 fix, so those columns are right.
 *
 * Dry run (default, writes nothing), prints the distribution per clinic:
 *   docker compose exec -T worker npx tsx scripts/fix-pt15-patient-segments.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-pt15-patient-segments.ts
 *
 * Idempotent: a second run finds nothing to change.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  classifyPatientSegment,
  type PatientSegmentValue,
} from "../src/lib/patients/segment-rules";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";
const PAGE = 1000;

type Tally = Record<PatientSegmentValue, number>;
const empty = (): Tally => ({ NEW: 0, ACTIVE: 0, DORMANT: 0, VIP: 0, CHURN: 0 });

async function main() {
  const now = new Date();
  const before = new Map<string, Tally>();
  const after = new Map<string, Tally>();
  const changes = new Map<PatientSegmentValue, string[]>();
  let scanned = 0;
  let cursor: string | null = null;

  for (;;) {
    const rows: Array<{
      id: string;
      clinicId: string;
      segment: PatientSegmentValue;
      visitsCount: number;
      lastVisitAt: Date | null;
      createdAt: Date;
    }> = await prisma.patient.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        clinicId: true,
        segment: true,
        visitsCount: true,
        lastVisitAt: true,
        createdAt: true,
      },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    scanned += rows.length;
    for (const r of rows) {
      const next = classifyPatientSegment({ ...r, current: r.segment }, now);
      const b = before.get(r.clinicId) ?? empty();
      const a = after.get(r.clinicId) ?? empty();
      b[r.segment] += 1;
      a[next] += 1;
      before.set(r.clinicId, b);
      after.set(r.clinicId, a);
      if (next !== r.segment) {
        const list = changes.get(next) ?? [];
        list.push(r.id);
        changes.set(next, list);
      }
    }
    if (rows.length < PAGE) break;
    cursor = rows[rows.length - 1]!.id;
  }

  for (const [clinicId, b] of before) {
    console.log(`clinic ${clinicId}`);
    console.log(`  before: ${JSON.stringify(b)}`);
    console.log(`  after:  ${JSON.stringify(after.get(clinicId))}`);
  }
  const total = [...changes.values()].reduce((n, ids) => n + ids.length, 0);
  console.log(`scanned=${scanned} to change=${total}`);

  if (!APPLY) {
    console.log("DRY RUN: nothing written. APPLY=1 to write.");
    return;
  }
  let written = 0;
  for (const [segment, ids] of changes) {
    for (let i = 0; i < ids.length; i += PAGE) {
      const res = await prisma.patient.updateMany({
        where: { id: { in: ids.slice(i, i + PAGE) }, segment: { not: "VIP" } },
        data: { segment },
      });
      written += res.count;
    }
  }
  console.log(`written=${written}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
