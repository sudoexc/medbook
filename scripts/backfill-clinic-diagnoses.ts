/**
 * One-off: teach each clinic's diagnosis list (ClinicDiagnosis) the wordings
 * its doctors already wrote.
 *
 * Until 25.09.2026 a hand-written diagnosis joined the shared list only when
 * the visit was SIGNED, and in this clinic most visits are drafts — so the
 * list stayed empty while doctors kept typing «тиннитус», «сдвг». From now
 * on a diagnosis is learned when chosen (visit-notes PATCH); this catches
 * up with the history. `usageCount` counts SIGNED uses, as the finalize path
 * does.
 *
 * Same filters as learnClinicDiagnosis: skip names that are just a code,
 * coded diagnoses the static ICD-10 list already has, and free text equal to
 * a static wording.
 *
 * Idempotent. DRY RUN by default; APPLY=1 writes.
 *
 * Prod:
 *   docker compose run --rm -e APPLY=1 -v /opt/neurofax/scripts:/app/scripts \
 *     worker npx tsx scripts/backfill-clinic-diagnoses.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { ICD10_ENTRIES } from "../src/server/icd10/data";
import { normalizeIcdTerm } from "../src/server/icd10/search";

// Same shape check as src/server/icd10/clinic-catalog.ts (not imported: that
// module pulls the app's Prisma client, which would keep this script alive).
function looksLikeIcdCode(s: string): boolean {
  return /^[A-Za-zА-Яа-я][0-9]{2}(?:\.[0-9A-Za-z]{1,3})?$/.test(s.trim());
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });
const APPLY = process.env.APPLY === "1";

async function main() {
  const staticCodes = new Set(ICD10_ENTRIES.map((e) => e.code.toLowerCase()));
  const staticNames = new Set(ICD10_ENTRIES.map((e) => normalizeIcdTerm(e.nameRu)));

  const notes = await prisma.visitNote.findMany({
    where: { diagnosisName: { not: null } },
    select: {
      clinicId: true,
      diagnosisCode: true,
      diagnosisName: true,
      status: true,
      createdAt: true,
      doctor: { select: { userId: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  type Acc = {
    clinicId: string;
    normalized: string;
    nameRu: string;
    code: string | null;
    signed: number;
    createdById: string | null;
  };
  const acc = new Map<string, Acc>();
  for (const n of notes) {
    const name = n.diagnosisName?.trim();
    if (!name || name.length < 3 || looksLikeIcdCode(name)) continue;
    const code = n.diagnosisCode?.trim() || null;
    if (code && staticCodes.has(code.toLowerCase())) continue;
    const normalized = normalizeIcdTerm(name);
    if (!normalized) continue;
    if (!code && staticNames.has(normalized)) continue;
    const key = `${n.clinicId}|${normalized}`;
    const cur = acc.get(key);
    const signed = n.status === "FINALIZED" ? 1 : 0;
    if (cur) {
      cur.signed += signed;
      cur.code ??= code;
      continue;
    }
    acc.set(key, {
      clinicId: n.clinicId,
      normalized,
      nameRu: name,
      code,
      signed,
      createdById: n.doctor?.userId ?? null,
    });
  }

  console.log(`[clinic-dx] notes with a diagnosis: ${notes.length}; wordings to know: ${acc.size}`);
  let created = 0;
  let updated = 0;
  for (const a of acc.values()) {
    const existing = await prisma.clinicDiagnosis.findUnique({
      where: { clinicId_normalized: { clinicId: a.clinicId, normalized: a.normalized } },
      select: { id: true, code: true, usageCount: true },
    });
    console.log(`  ${existing ? "=" : "+"} ${a.code ?? "—"} ${a.nameRu} (signed ${a.signed})`);
    if (!APPLY) continue;
    if (existing) {
      if ((a.code && !existing.code) || existing.usageCount < a.signed) {
        updated += 1;
        await prisma.clinicDiagnosis.update({
          where: { id: existing.id },
          data: {
            ...(a.code && !existing.code ? { code: a.code } : {}),
            usageCount: Math.max(existing.usageCount, a.signed),
          },
        });
      }
    } else {
      created += 1;
      await prisma.clinicDiagnosis.create({
        data: {
          clinicId: a.clinicId,
          code: a.code,
          nameRu: a.nameRu,
          normalized: a.normalized,
          usageCount: a.signed,
          createdById: a.createdById,
        },
      });
    }
  }
  console.log(`[clinic-dx] created=${created} updated=${updated}${APPLY ? "" : " (dry run)"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
