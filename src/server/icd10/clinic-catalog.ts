/**
 * The clinic's self-learning diagnosis catalog.
 *
 * The bundled ICD-10 list (10 414 codes) is complete but not exhaustive of
 * wordings — a working neurologist still hits «в списке нет». Instead of an
 * admin screen nobody will maintain, the catalog learns from practice: a
 * diagnosis a doctor writes by hand joins the picker for every doctor of the
 * clinic as soon as he CHOOSES it for a visit (25.09.2026 — it used to wait
 * for signing, and in this clinic most visits are never signed, so nothing
 * was ever shared). `usageCount` still counts signed uses only.
 *
 * Codes: when the doctor supplied one that the static catalog does not know
 * («код знаю, в базе нет»), it is stored and searchable. Pairs that ARE in
 * the static catalog are deliberately not learned — duplicating the built-in
 * list would only add noise.
 */
import { prisma } from "@/lib/prisma";
import { ICD10_ENTRIES } from "./data";
import { normalizeIcdTerm } from "./search";

/** Static codes, for the "don't relearn what we ship" check. */
let staticCodes: Set<string> | null = null;
function isStaticCode(code: string): boolean {
  staticCodes ??= new Set(ICD10_ENTRIES.map((e) => e.code.toLowerCase()));
  return staticCodes.has(code.toLowerCase());
}

/** Static wordings, for the same check on free text. */
let staticNames: Set<string> | null = null;
function isStaticName(normalized: string): boolean {
  staticNames ??= new Set(ICD10_ENTRIES.map((e) => normalizeIcdTerm(e.nameRu)));
  return staticNames.has(normalized);
}

/** Loose ICD-shaped code: letter, two digits, optional dotted suffix. */
export function looksLikeIcdCode(s: string): boolean {
  return /^[A-Za-zА-Яа-я][0-9]{2}(?:\.[0-9A-Za-z]{1,3})?$/.test(s.trim());
}

/**
 * Learn a signed diagnosis. Fire-and-forget from finalize — a catalog hiccup
 * must never fail the signing transaction it rides on.
 */
export async function learnClinicDiagnosis(args: {
  code: string | null;
  nameRu: string | null;
  createdById: string | null;
  /** Signing counts a use; choosing it on a draft only makes it known. */
  countUse?: boolean;
}): Promise<void> {
  const countUse = args.countUse ?? true;
  const name = args.nameRu?.trim();
  if (!name || name.length < 3) return;
  // «F20.0» typed into the name field is a code, not a wording to teach.
  if (looksLikeIcdCode(name)) return;

  const code = args.code?.trim() || null;
  // A coded diagnosis the static catalog already knows — nothing to learn.
  if (code && isStaticCode(code)) return;
  // Free text only counts when it is NOT already a static wording either.
  const normalized = normalizeIcdTerm(name);
  if (!normalized) return;
  if (!code && isStaticName(normalized)) return;

  try {
    // find-then-write instead of upsert: the tenant extension reliably scopes
    // findFirst/create/update, while rewriting a compound unique key inside
    // upsert's `where` is exactly the kind of edge it may miss. The unique
    // (clinicId, normalized) index backstops the rare concurrent double.
    const existing = await prisma.clinicDiagnosis.findFirst({
      where: { normalized },
      select: { id: true, code: true },
    });
    if (existing) {
      const data = {
        ...(countUse ? { usageCount: { increment: 1 } } : {}),
        // A later pick may supply the code the first one lacked.
        ...(code && !existing.code ? { code } : {}),
      };
      if (Object.keys(data).length > 0) {
        await prisma.clinicDiagnosis.update({
          where: { id: existing.id },
          data,
        });
      }
    } else {
      await prisma.clinicDiagnosis.create({
        data: {
          code,
          nameRu: name,
          normalized,
          usageCount: countUse ? 1 : 0,
          createdById: args.createdById,
        } as never,
      });
    }
  } catch (e) {
    console.warn(
      `[clinic-catalog] learn failed for "${name}": ${(e as Error).message}`,
    );
  }
}

export type ClinicCatalogHit = {
  code: string;
  nameRu: string;
  /** Marks a clinic-learned entry so the picker can badge it. */
  custom: true;
  usageCount: number;
};

/**
 * Clinic entries matching the query, ranked by usage. Small table (hundreds
 * of rows at most), indexed by clinic — one cheap query per keystroke.
 */
export async function searchClinicCatalog(
  rawQuery: string,
  limit: number,
): Promise<ClinicCatalogHit[]> {
  const term = normalizeIcdTerm(rawQuery);
  if (!term) return [];

  const found = await prisma.clinicDiagnosis.findMany({
    where: {
      OR: [
        { normalized: { contains: term } },
        { code: { startsWith: term, mode: "insensitive" } },
      ],
    },
    select: { code: true, nameRu: true, usageCount: true },
    orderBy: [{ usageCount: "desc" }, { nameRu: "asc" }],
    take: limit * 2,
  });

  // An entry learned from a draft (never signed, usageCount 0) is offered
  // only while some visit still carries that wording. A typo the doctor
  // corrected a minute later leaves no trace in everyone's picker.
  const unsigned = found.filter((r) => r.usageCount === 0);
  let live = new Set<string>();
  if (unsigned.length > 0) {
    const inUse = await prisma.visitNote.findMany({
      where: {
        OR: unsigned.map((r) => ({
          diagnosisName: { equals: r.nameRu, mode: "insensitive" as const },
        })),
      },
      select: { diagnosisName: true },
      take: 200,
    });
    live = new Set(
      inUse.map((n) => normalizeIcdTerm(n.diagnosisName ?? "")),
    );
  }
  const rows = found
    .filter((r) => r.usageCount > 0 || live.has(normalizeIcdTerm(r.nameRu)))
    .slice(0, limit);

  return rows.map((r) => ({
    code: r.code ?? "",
    nameRu: r.nameRu,
    custom: true as const,
    usageCount: r.usageCount,
  }));
}
