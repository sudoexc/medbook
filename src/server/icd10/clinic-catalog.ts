/**
 * The clinic's self-learning diagnosis catalog.
 *
 * The bundled ICD-10 list (10 414 codes) is complete but not exhaustive of
 * wordings — a working neurologist still hits «в списке нет». Instead of an
 * admin screen nobody will maintain, the catalog learns from practice: every
 * diagnosis a doctor typed by hand and then SIGNED is upserted here and joins
 * the picker for every doctor of the clinic. Signing is the quality gate —
 * abandoned typing and typos never make it in.
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
}): Promise<void> {
  const name = args.nameRu?.trim();
  if (!name || name.length < 3) return;

  const code = args.code?.trim() || null;
  // A coded diagnosis the static catalog already knows — nothing to learn.
  if (code && isStaticCode(code)) return;
  // Free text only counts when it is NOT already a static wording either.
  const normalized = normalizeIcdTerm(name);
  if (!normalized) return;

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
      await prisma.clinicDiagnosis.update({
        where: { id: existing.id },
        data: {
          usageCount: { increment: 1 },
          // A later signing may supply the code the first one lacked.
          ...(code && !existing.code ? { code } : {}),
        },
      });
    } else {
      await prisma.clinicDiagnosis.create({
        data: {
          code,
          nameRu: name,
          normalized,
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

  const rows = await prisma.clinicDiagnosis.findMany({
    where: {
      OR: [
        { normalized: { contains: term } },
        { code: { startsWith: term, mode: "insensitive" } },
      ],
    },
    select: { code: true, nameRu: true, usageCount: true },
    orderBy: [{ usageCount: "desc" }, { nameRu: "asc" }],
    take: limit,
  });

  return rows.map((r) => ({
    code: r.code ?? "",
    nameRu: r.nameRu,
    custom: true as const,
    usageCount: r.usageCount,
  }));
}
