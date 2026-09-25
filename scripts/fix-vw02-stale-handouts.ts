/**
 * Audit VW-02 data fix: signed conclusions whose patient handout is stale.
 *
 * The handout (the patient's PDF and the Mini App «что сказал врач») was
 * composed once, at the first signature, and never again. A dose or diagnosis
 * corrected inside the 24h window, or a drug removed after a revert and
 * re-sign, left the old text in front of the patient. The code now recomposes
 * it on every signature and correction; this script repairs the notes that
 * went stale before that.
 *
 * A note is repaired when it is FINALIZED, signed since SINCE (default
 * 2026-09-21, the day the handout tab was removed: before it a doctor could
 * have written the handout by hand, and that text is left alone), and its
 * stored handout differs from the one its current fields compose. For each:
 *   - the state being replaced is kept as a revision (PRE_EDIT) when no
 *     revision holds it yet (audit G1-01: nothing signed is ever lost);
 *   - the handout is recomposed and `handoutStaleAt` set, so the worker
 *     renders a fresh PDF under a new key within ~30 s;
 *   - the result is recorded as an EDITED revision by «system».
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-vw02-stale-handouts.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-vw02-stale-handouts.ts
 * Another cut-off:
 *   docker compose exec -T -e SINCE=2026-09-01 worker npx tsx scripts/fix-vw02-stale-handouts.ts
 *
 * Idempotent: a repaired note's handout equals its composition and no longer
 * matches.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import { composeNoteHandout } from "../src/server/visit-notes/handout";
import {
  changedRevisionFields,
  revisionContentOf,
  sameRevisionContent,
} from "../src/server/visit-notes/revisions";
import { storageKeyFromUrl } from "../src/lib/storage-ref";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";
const SINCE = new Date(process.env.SINCE ?? "2026-09-21T00:00:00+05:00");

async function main() {
  if (Number.isNaN(SINCE.getTime())) throw new Error(`bad SINCE: ${process.env.SINCE}`);

  const notes = await prisma.visitNote.findMany({
    where: { status: "FINALIZED", firstFinalizedAt: { gte: SINCE } },
    include: {
      patient: { select: { fullName: true } },
      doctor: { select: { nameRu: true, specializationRu: true } },
      clinic: { select: { nameRu: true } },
      appointment: { select: { date: true } },
      visitPrescriptions: { orderBy: { sortOrder: "asc" } },
      conclusionDocument: { select: { fileUrl: true } },
    },
    orderBy: { firstFinalizedAt: "asc" },
  });

  const stale = notes
    .map((note) => ({
      note,
      composed: composeNoteHandout(note, {
        diagnosisName: note.diagnosisName,
        complaints: note.complaints,
        prescriptions: note.prescriptions,
        advice: note.advice,
        followUpNote: note.followUpNote,
        visitPrescriptions: note.visitPrescriptions,
      }),
    }))
    .filter(
      ({ note, composed }) =>
        (note.patientHandoutMarkdown ?? "").trim() !== (composed ?? "").trim(),
    );

  console.log(
    `┌─ ${APPLY ? "APPLY" : "DRY RUN"}: ${stale.length} of ${notes.length} signed conclusions since ${SINCE.toISOString().slice(0, 10)} have a stale handout`,
  );
  for (const { note } of stale) {
    console.log(
      `  ${note.documentNumber ?? note.id}  ${note.patient.fullName}  signed ${note.firstFinalizedAt?.toISOString().slice(0, 16)}`,
    );
  }

  if (!APPLY || stale.length === 0) {
    console.log(
      `└─ would recompose: ${stale.length}` +
        (APPLY ? "" : ". Nothing written; run again with APPLY=1"),
    );
    await prisma.$disconnect();
    return;
  }

  let fixed = 0;
  for (const { note, composed } of stale) {
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.visitNote.update({
        where: { id: note.id },
        data: { patientHandoutMarkdown: composed, handoutStaleAt: now },
      });
      const before = revisionContentOf(note, note.visitPrescriptions);
      const after = revisionContentOf(updated, note.visitPrescriptions);
      const latest = await tx.visitNoteRevision.findFirst({
        where: { visitNoteId: note.id },
        orderBy: { revision: "desc" },
        select: { revision: true, content: true },
      });
      let revision = latest?.revision ?? 0;
      if (
        !latest ||
        !sameRevisionContent(latest.content as Record<string, unknown>, before)
      ) {
        revision += 1;
        await tx.visitNoteRevision.create({
          data: {
            clinicId: note.clinicId,
            visitNoteId: note.id,
            revision,
            kind: "PRE_EDIT",
            content: before as unknown as Prisma.InputJsonValue,
            pdfObjectKey: latest
              ? null
              : storageKeyFromUrl(note.conclusionDocument?.fileUrl),
          },
        });
      }
      await tx.visitNoteRevision.create({
        data: {
          clinicId: note.clinicId,
          visitNoteId: note.id,
          revision: revision + 1,
          kind: "EDITED",
          content: after as unknown as Prisma.InputJsonValue,
          changedFields: changedRevisionFields(before, after),
          // No author: the history shows it as a system change.
          authorUserId: null,
          authorName: null,
        },
      });
    });
    fixed += 1;
  }
  console.log(`└─ recomposed: ${fixed}; the worker re-renders their PDFs`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
