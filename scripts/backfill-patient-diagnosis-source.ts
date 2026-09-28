/**
 * Audit VW-10 backfill: link existing PatientDiagnosis rows to the signed
 * visit note that created them (`sourceVisitNoteId`).
 *
 * A correction of a signed diagnosis now moves or resolves the row its note
 * put on the patient's card. Rows created before the column existed carry
 * no link, so a note signed before the deploy and corrected (or re-signed
 * after a revert) afterwards would still leave its old diagnosis ACTIVE.
 *
 * The link is exact, not guessed: finalize created the row in the same
 * transaction as the signature, with `diagnosedAt` set to the very instant
 * stamped on the note (`finalizedAt`, `firstFinalizedAt`) and on its SIGNED
 * revision. A row is linked only when exactly one note of the same patient
 * was signed at that instant with that diagnosis. Rows typed in the card
 * (their date is a calendar day, no signature matches it) and rows an
 * existing diagnosis was re-activated into keep NULL, as the app intends.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/backfill-patient-diagnosis-source.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/backfill-patient-diagnosis-source.ts
 *
 * Idempotent: only rows whose link is still NULL are read, and each write
 * is conditional on it still being NULL.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

async function main() {
  const rows = await prisma.patientDiagnosis.findMany({
    where: { sourceVisitNoteId: null, diagnosedAt: { not: null } },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      icd10Code: true,
      label: true,
      diagnosedAt: true,
    },
  });

  let linked = 0;
  let ambiguous = 0;
  for (const row of rows) {
    const at = row.diagnosedAt!;
    // Every note of this patient signed at exactly that instant, by any of
    // its signatures (a re-signature after a revert keeps only the latest on
    // the note itself; the revision rows keep them all).
    const notes = await prisma.visitNote.findMany({
      where: {
        clinicId: row.clinicId,
        patientId: row.patientId,
        OR: [
          { finalizedAt: at },
          { firstFinalizedAt: at },
          { revisions: { some: { kind: "SIGNED", createdAt: at } } },
        ],
      },
      select: {
        id: true,
        documentNumber: true,
        diagnosisCode: true,
        diagnosisName: true,
        revisions: {
          where: { kind: "SIGNED", createdAt: at },
          select: { content: true },
        },
      },
    });
    // The diagnosis the note carried at that signature: the revision says,
    // the note itself does for signatures before revisions existed.
    const carried = notes.filter((n) => {
      const signed = n.revisions[0]?.content as
        | { diagnosisCode?: string | null; diagnosisName?: string | null }
        | undefined;
      const code = (signed ? signed.diagnosisCode : n.diagnosisCode) ?? null;
      const name = (signed ? signed.diagnosisName : n.diagnosisName)?.trim() ?? null;
      return row.icd10Code
        ? code === row.icd10Code
        : !code && !!name && name === row.label.trim();
    });
    if (carried.length !== 1) {
      if (carried.length > 1) ambiguous += 1;
      continue;
    }
    const note = carried[0]!;
    console.log(
      `${APPLY ? "LINK" : "WOULD LINK"} diagnosis ${row.id} (${row.icd10Code ?? row.label}) → note ${note.id}${note.documentNumber ? ` ${note.documentNumber}` : ""}`,
    );
    if (APPLY) {
      const res = await prisma.patientDiagnosis.updateMany({
        where: { id: row.id, sourceVisitNoteId: null },
        data: { sourceVisitNoteId: note.id },
      });
      linked += res.count;
    } else {
      linked += 1;
    }
  }

  console.log(
    `${APPLY ? "Linked" : "DRY RUN: would link"} ${linked} of ${rows.length} unlinked row(s); ${ambiguous} ambiguous left as they are.` +
      (APPLY ? "" : " Nothing written; run again with APPLY=1"),
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
