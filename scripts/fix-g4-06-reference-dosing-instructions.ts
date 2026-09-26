/**
 * Audit G4-06 data fix: prescription rows whose «Как принимать» is the
 * catalog's reference dosing text, not something the doctor wrote.
 *
 * The constructor used to copy `Drug.defaultDosing.adult` into
 * `instructionRu` of every new row. That text is written for the doctor
 * («Старт 100–200 мг 1–2 раза в день, титровать до 400–1200 мг/сут»,
 * «Депрессия: 25–75 мг/сут…; нейропатическая боль: …»), and it went to the
 * patient's handout, the print and the medication reminders. New rows start
 * empty now; this script clears the copied text from rows already saved.
 *
 * Scope: rows of notes that were NEVER signed (status DRAFT, no
 * firstFinalizedAt). A row is cleared only when its instruction equals one
 * of its drug's reference texts (adult / elderly / pediatric / renal,
 * compared ignoring whitespace), so anything the doctor typed or edited is
 * kept. Signed and reopened notes are only listed: they are medical records
 * with revisions and an issued PDF, and change through the doctor's own
 * correction, not a data fix.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-g4-06-reference-dosing-instructions.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-g4-06-reference-dosing-instructions.ts
 *
 * Idempotent: a cleared row has no instruction and no longer matches. Safe to
 * re-run later the same day for rows saved from a browser tab still running
 * the previous build.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function referenceTexts(defaultDosing: unknown): Set<string> {
  const out = new Set<string>();
  if (!defaultDosing || typeof defaultDosing !== "object") return out;
  for (const k of ["adult", "elderly", "pediatric", "renal"]) {
    const v = (defaultDosing as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim()) out.add(squash(v));
  }
  return out;
}

async function main() {
  const rows = await prisma.visitPrescription.findMany({
    where: { instructionRu: { not: null }, drugId: { not: null } },
    select: {
      id: true,
      displayName: true,
      instructionRu: true,
      drug: { select: { defaultDosing: true } },
      visitNote: {
        select: {
          id: true,
          status: true,
          firstFinalizedAt: true,
          documentNumber: true,
          patient: { select: { fullName: true } },
        },
      },
    },
  });

  const copied = rows.filter((r) =>
    referenceTexts(r.drug?.defaultDosing).has(squash(r.instructionRu ?? "")),
  );
  const drafts = copied.filter(
    (r) => r.visitNote.status === "DRAFT" && r.visitNote.firstFinalizedAt == null,
  );
  const signed = copied.filter((r) => !drafts.includes(r));

  console.log(
    `┌─ ${APPLY ? "APPLY" : "DRY RUN"}: ${copied.length} of ${rows.length} rows with an instruction carry the catalog's reference text`,
  );
  console.log(`│  in unsigned drafts (cleared): ${drafts.length}`);
  for (const r of drafts) {
    console.log(`│    ${r.visitNote.id}  ${r.displayName}`);
  }
  console.log(`│  in signed or reopened notes (left as issued): ${signed.length}`);
  for (const r of signed) {
    console.log(
      `│    ${r.visitNote.documentNumber ?? r.visitNote.id}  ${r.visitNote.patient.fullName}  ${r.displayName}`,
    );
  }

  if (!APPLY || drafts.length === 0) {
    console.log(
      `└─ would clear: ${drafts.length}` +
        (APPLY ? "" : ". Nothing written; run again with APPLY=1"),
    );
    await prisma.$disconnect();
    return;
  }

  // Re-check the value in the WHERE: a doctor editing the row between the
  // read above and this write keeps his text.
  let cleared = 0;
  for (const r of drafts) {
    const res = await prisma.visitPrescription.updateMany({
      where: {
        id: r.id,
        instructionRu: r.instructionRu,
        visitNote: { status: "DRAFT", firstFinalizedAt: null },
      },
      data: { instructionRu: null },
    });
    cleared += res.count;
  }
  console.log(`└─ cleared: ${cleared}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
