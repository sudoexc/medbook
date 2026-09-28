/**
 * Audit PT-10 data fix: courses still running on cases closed before the fix.
 *
 * Closing a case used to leave its prescriptions ACTIVE: the patient's Mini
 * App kept listing the drug and the hourly worker kept reminding them to
 * take it. The app now ends the courses when a case closes, and the worker
 * no longer reminds a course of a closed case, so no reminder goes out
 * either way. This script ends the courses left behind, the way closing
 * does now:
 *   - case RESOLVED: ACTIVE / PAUSED courses become COMPLETED;
 *   - case ABANDONED / TRANSFERRED: they become CANCELLED.
 * Each course is listed with the patient's card number so the doctor can
 * restore one on the case page if it should go on.
 *
 * WHEN: any time after the deploy that ships PT-10.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-pt10-closed-case-prescriptions.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-pt10-closed-case-prescriptions.ts
 *
 * Idempotent: an ended course is no longer ACTIVE / PAUSED, and each write
 * only lands while the course and its case still read as they were read.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  RUNNING_PRESCRIPTION_STATUSES,
  prescriptionStatusOnCaseClose,
} from "../src/lib/cases/case-close";

export type Pt10Db = Pick<PrismaClient, "prescription">;

export async function fixPt10ClosedCasePrescriptions(
  db: Pt10Db,
  apply: boolean,
  log: (line: string) => void = console.log,
): Promise<{ found: number; written: number }> {
  const rows = await db.prescription.findMany({
    where: {
      status: { in: [...RUNNING_PRESCRIPTION_STATUSES] },
      case: { status: { not: "OPEN" } },
    },
    select: {
      id: true,
      status: true,
      drugName: true,
      caseId: true,
      case: { select: { status: true } },
      patient: { select: { patientNumber: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  log(`┌─ ${apply ? "APPLY" : "DRY RUN"}`);
  log(`│ running courses on closed cases: ${rows.length}`);
  let written = 0;
  for (const rx of rows) {
    const caseStatus = rx.case?.status ?? "OPEN";
    const next = prescriptionStatusOnCaseClose(caseStatus);
    if (!next || !rx.caseId) continue;
    log(
      `│   P-${rx.patient.patientNumber} ${rx.drugName} (${rx.id}): ` +
        `${rx.status} → ${next} (case ${rx.caseId} ${caseStatus})`,
    );
    if (!apply) continue;
    const res = await db.prescription.updateMany({
      where: {
        id: rx.id,
        status: rx.status,
        case: { status: caseStatus as never },
      },
      data: { status: next },
    });
    written += res.count;
  }
  log(apply ? `└─ courses ended: ${written}` : "└─ nothing written; run again with APPLY=1");
  return { found: rows.length, written };
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
  });
  try {
    await fixPt10ClosedCasePrescriptions(prisma, process.env.APPLY === "1");
  } finally {
    await prisma.$disconnect();
  }
}

// `tsx scripts/fix-pt10-closed-case-prescriptions.ts` is the entry point; the
// unit test imports the function without touching a database.
if (process.argv[1]?.includes("fix-pt10-closed-case-prescriptions")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
