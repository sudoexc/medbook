/**
 * The WIPE phase shared by wipe-neurofax-demo.ts and seed-mega-neurofax.ts
 * (audit G2-09): every patient-derived row of one clinic goes, or nothing
 * does.
 *
 * Both scripts used to carry their own copy of a hand-written table list
 * without `Referral`, whose patient link is ON DELETE RESTRICT. One
 * referral in the clinic made `DELETE FROM "Patient"` fail; the error was
 * caught and printed as a warning, after visits, payments and documents
 * were already gone, and then `patientCounter` was reset to 0 while the
 * patients numbered 1..N were still there. Every new patient card (reception
 * and kiosk walk-in alike) then hit the unique (clinicId, patientNumber)
 * index, rolled back together with its counter increment and got the same
 * number on the next try: registration was broken until someone fixed the
 * counter by hand.
 *
 * Now:
 *   - the order is checked against the live foreign keys (pg_constraint)
 *     before the first DELETE: a RESTRICT / NO ACTION link from a table
 *     outside the list, or a child listed after its parent, stops the run
 *     with the table named, nothing deleted;
 *   - all DELETEs and the counter run in one transaction, and a failing
 *     DELETE throws (rolls everything back) instead of being swallowed;
 *   - `patientCounter` becomes the highest `patientNumber` still in the
 *     clinic (0 when every patient is gone), never a blind 0.
 */
import type { PrismaClient } from "../src/generated/prisma/client";

/** Child-before-parent; only tables with a clinicId column are touched. */
export const CLINIC_WIPE_ORDER = [
  "MessageRead",
  "Message",
  "Conversation",
  "MedicationReminderSend",
  "Reminder",
  "NotificationSend",
  "Campaign",
  "AppointmentService",
  "Payment",
  "Invoice",
  "Document",
  "Communication",
  // Referral → Patient is ON DELETE RESTRICT (audit G2-09); its visit and
  // scheduled-visit links are SET NULL, so it can go before both.
  "Referral",
  "VisitNote",
  "Prescription",
  "EPrescription",
  "SickLeave",
  "LabResult",
  "LabOrder",
  "CdsOverride",
  "PatientReview",
  "PatientFamily",
  "PatientAllergy",
  "PatientChronicCondition",
  "PatientDiagnosis",
  "PatientView",
  "Review",
  "Appointment",
  "MedicalCase",
  "Call",
  "OnlineRequest",
  // "Lead" deliberately absent: those are real booking requests from the
  // public site (audit LD-01); its patient link is SET NULL. Demo leads are
  // tagged «[demo]» and removed by seed-demo-data itself.
  "Action",
  "EmptySlotSnapshot",
  "ReferralReward",
  "DataExportJob",
  "DataDeletionJob",
  "AuditLog",
  "LLMUsage",
  "Patient",
] as const;

/** One foreign key as Postgres reports it (`pg_constraint.confdeltype`). */
export type FkEdge = {
  child: string;
  parent: string;
  /** a = NO ACTION, r = RESTRICT, c = CASCADE, n = SET NULL, d = SET DEFAULT */
  onDelete: string;
};

/**
 * Why deleting `order` (scoped by clinicId) would fail half-way, one line
 * per blocking foreign key; empty when the order is safe. Pure.
 *
 * Only RESTRICT / NO ACTION links can block a DELETE: CASCADE removes the
 * child rows with the parent (visit-note revisions, Telegram invite tokens)
 * and SET NULL detaches them (a site Lead keeps living without its patient).
 */
export function wipeOrderProblems(
  order: readonly string[],
  edges: readonly FkEdge[],
  hasClinicId: ReadonlySet<string>,
): string[] {
  const position = new Map(order.map((t, i) => [t, i]));
  const problems: string[] = [];
  for (const e of edges) {
    if (e.onDelete !== "a" && e.onDelete !== "r") continue;
    if (e.child === e.parent) continue;
    const parentAt = position.get(e.parent);
    if (parentAt === undefined || !hasClinicId.has(e.parent)) continue;
    const childAt = position.get(e.child);
    if (childAt === undefined) {
      problems.push(
        `${e.child} → ${e.parent}: ${e.child} is not in the wipe list and blocks deleting ${e.parent}`,
      );
    } else if (!hasClinicId.has(e.child)) {
      problems.push(
        `${e.child} → ${e.parent}: ${e.child} has no clinicId column, its rows cannot be scoped to the clinic`,
      );
    } else if (childAt > parentAt) {
      problems.push(`${e.child} → ${e.parent}: ${e.child} must be deleted before ${e.parent}`);
    }
  }
  return problems;
}

type Log = (line: string) => void;

const FK_EDGES_SQL = `
  SELECT ch.relname AS child, pa.relname AS parent, c.confdeltype AS "onDelete"
    FROM pg_constraint c
    JOIN pg_class ch ON ch.oid = c.conrelid
    JOIN pg_class pa ON pa.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = c.connamespace
   WHERE c.contype = 'f' AND n.nspname = 'public'`;

const CLINIC_ID_TABLES_SQL = `
  SELECT table_name FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'clinicId'`;

/**
 * Delete every patient-derived row of `clinicId`, all or nothing, and set
 * `patientCounter` to the highest patient number left (0 after a full wipe).
 * Throws, with nothing deleted, when the order does not match the schema or
 * any DELETE fails.
 */
export async function wipeClinicDemoData(
  prisma: PrismaClient,
  clinicId: string,
  log: Log = (line) => console.log(line),
): Promise<{ deleted: number; patientCounter: number }> {
  const clinicTables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    CLINIC_ID_TABLES_SQL,
  );
  const hasClinicId = new Set(clinicTables.map((r) => r.table_name));
  const edges = await prisma.$queryRawUnsafe<FkEdge[]>(FK_EDGES_SQL);
  const problems = wipeOrderProblems(CLINIC_WIPE_ORDER, edges, hasClinicId);
  if (problems.length > 0) {
    throw new Error(
      `wipe order does not match the schema, nothing deleted:\n  ${problems.join("\n  ")}`,
    );
  }

  return prisma.$transaction(
    async (tx) => {
      let deleted = 0;
      for (const table of CLINIC_WIPE_ORDER) {
        if (!hasClinicId.has(table)) {
          log(`  · ${table}: (no clinicId column, skip)`);
          continue;
        }
        // No try/catch on purpose: a failed DELETE must abort the whole
        // transaction, never leave the clinic half wiped (audit G2-09).
        const res = await tx.$executeRawUnsafe(
          `DELETE FROM "${table}" WHERE "clinicId" = $1`,
          clinicId,
        );
        if (res > 0) {
          log(`  ✗ ${table}: -${res}`);
          deleted += res;
        }
      }
      // Next number = highest one still taken. A blind 0 next to surviving
      // patients 1..N made every new card collide on the unique index.
      const [row] = await tx.$queryRawUnsafe<{ patientCounter: number }[]>(
        `UPDATE "Clinic"
            SET "patientCounter" = COALESCE(
              (SELECT MAX("patientNumber") FROM "Patient" WHERE "clinicId" = $1), 0)
          WHERE "id" = $1
          RETURNING "patientCounter"`,
        clinicId,
      );
      return { deleted, patientCounter: Number(row?.patientCounter ?? 0) };
    },
    { maxWait: 10_000, timeout: 10 * 60_000 },
  );
}
