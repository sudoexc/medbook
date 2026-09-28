/**
 * Upsert of the curated GLOBAL ClinicalProtocol rows (audit G2-05).
 *
 * ClinicalProtocol holds three scopes in one table: global seed rows
 * (clinicId and doctorId null), clinic-own rows (clinicId set) and a doctor's
 * personal rows («сохранить приём как протокол», clinicId + doctorId set).
 * The old seed ran `deleteMany({ diagnosisCodePrefix: { in: prefixes } })`
 * with no scope filter, and the curated prefixes (G43, M54, F41, G47.0, I10…)
 * are exactly the ones a neurologist saves his own protocols under, so one
 * catalog refresh erased them on the live clinic.
 *
 * Now only global rows are read or written, and a global row is updated in
 * place: its id survives, because a clinic hides a global protocol through a
 * catalog overlay keyed by that id (`loadHiddenCodes(clinicId, "PROTOCOL")`),
 * and a delete + re-insert would silently bring hidden protocols back.
 * Nothing is ever deleted.
 *
 * Kept free of a Prisma client so the unit test can drive it with a fake.
 */
import type { PrismaClient } from "../src/generated/prisma/client";

import type { ProtocolSeed } from "./_protocol-data";

export type ProtocolSeedDb = Pick<PrismaClient, "clinicalProtocol">;

/** The only rows this seed may touch. */
export const GLOBAL_PROTOCOL_SCOPE = { clinicId: null, doctorId: null } as const;

export type ProtocolSeedResult = {
  created: number;
  updated: number;
  /** Extra global rows sharing a curated prefix; reported, never removed. */
  duplicates: string[];
};

function seedFields(p: ProtocolSeed) {
  return {
    diagnosisCodePrefix: p.diagnosisCodePrefix,
    nameRu: p.nameRu,
    nameUz: p.nameUz ?? null,
    summaryRu: p.summaryRu ?? null,
    complaintsTemplate: p.complaintsTemplate ?? [],
    anamnesisTemplate: p.anamnesisTemplate ?? [],
    examinationTemplate: p.examinationTemplate ?? [],
    prescriptionsTemplate: p.prescriptionsTemplate ?? [],
    adviceTemplate: p.adviceTemplate ?? [],
    recommendedLabs: p.recommendedLabs ?? [],
    conclusionTemplateMd: p.conclusionTemplateMd ?? null,
    sortOrder: p.sortOrder ?? 0,
  };
}

export async function seedGlobalProtocols(
  db: ProtocolSeedDb,
  protocols: readonly ProtocolSeed[],
  opts: { apply: boolean },
): Promise<ProtocolSeedResult> {
  // The prefix is the upsert key: two curated entries under one prefix would
  // overwrite each other on every run.
  const prefixes = protocols.map((p) => p.diagnosisCodePrefix);
  const repeated = prefixes.filter((p, i) => prefixes.indexOf(p) !== i);
  if (repeated.length > 0) {
    throw new Error(`Curated protocols repeat a prefix: ${[...new Set(repeated)].join(", ")}`);
  }

  const existing = await db.clinicalProtocol.findMany({
    where: { ...GLOBAL_PROTOCOL_SCOPE, diagnosisCodePrefix: { in: prefixes } },
    select: { id: true, diagnosisCodePrefix: true },
    orderBy: { createdAt: "asc" },
  });
  const byPrefix = new Map<string, string[]>();
  for (const row of existing) {
    const ids = byPrefix.get(row.diagnosisCodePrefix) ?? [];
    ids.push(row.id);
    byPrefix.set(row.diagnosisCodePrefix, ids);
  }

  const result: ProtocolSeedResult = { created: 0, updated: 0, duplicates: [] };
  for (const p of protocols) {
    const [keep, ...extra] = byPrefix.get(p.diagnosisCodePrefix) ?? [];
    result.duplicates.push(...extra);
    if (keep) {
      // `active` is left as it is: the refresh updates content, it does not
      // undo a decision taken on the row.
      if (opts.apply) {
        // Scope repeated in the filter: a row that is not global fails the
        // update instead of being overwritten.
        await db.clinicalProtocol.update({
          where: { id: keep, ...GLOBAL_PROTOCOL_SCOPE },
          data: seedFields(p),
        });
      }
      result.updated += 1;
    } else {
      if (opts.apply) {
        await db.clinicalProtocol.create({
          data: { ...GLOBAL_PROTOCOL_SCOPE, ...seedFields(p), active: true },
        });
      }
      result.created += 1;
    }
  }
  return result;
}
