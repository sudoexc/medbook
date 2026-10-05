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
import { parseAdditionalDiagnoses } from "@/lib/visit-diagnoses";
import { ICD10_ENTRIES, type Icd10Entry } from "./data";
import { icdQueryTerms, normalizeIcdTerm } from "./search";

/** Static codes, for the "don't relearn what we ship" check. */
let staticCodes: Set<string> | null = null;
function isStaticCode(code: string): boolean {
  staticCodes ??= new Set(ICD10_ENTRIES.map((e) => e.code.toLowerCase()));
  return staticCodes.has(code.toLowerCase());
}

/**
 * The codes of `codes` a doctor may pin to his arsenal (a star on the visit
 * screen, «В арсенал» on «Мой арсенал»), upper case: a code of the bundled
 * classifier, or one the clinic's own catalog holds (a diagnosis learned
 * with a code the classifier lacks, «код знаю, в базе нет»).
 *
 * WHY: a pin is only a code, and it was stored unchecked, so a typo or a
 * code from nowhere sat in his 30 as a slot with no name that adds nothing
 * to a visit. The clinic catalog is read in the caller's tenant context
 * (one indexed query, only for codes the classifier does not know).
 */
export async function pinnableDiagnosisCodes(
  codes: readonly string[],
): Promise<Set<string>> {
  const wanted = [...new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  const out = new Set(wanted.filter((c) => isStaticCode(c)));
  const rest = wanted.filter((c) => !out.has(c));
  if (rest.length === 0) return out;
  // One `equals` per code: case-insensitive equality is the filter every
  // Prisma version runs the same way (the clinic stored codes as typed).
  const learned = await prisma.clinicDiagnosis.findMany({
    where: { OR: rest.map((c) => ({ code: { equals: c, mode: "insensitive" as const } })) },
    select: { code: true },
    take: rest.length * 4,
  });
  for (const row of learned) {
    const code = row.code?.trim().toUpperCase();
    if (code && rest.includes(code)) out.add(code);
  }
  return out;
}

/** One code, see `pinnableDiagnosisCodes`. */
export async function isPinnableDiagnosisCode(code: string): Promise<boolean> {
  return (await pinnableDiagnosisCodes([code])).has(code.trim().toUpperCase());
}

/**
 * A wording compared without its punctuation: «Мигрень без ауры [простая
 * мигрень]» and «Мигрень без ауры, простая мигрень» are the same words.
 */
function wordsOnly(normalized: string): string {
  return normalized.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Static wordings, for the same check on free text. */
let staticNames: Set<string> | null = null;
export function isStaticName(normalized: string): boolean {
  staticNames ??= new Set(
    ICD10_ENTRIES.map((e) => wordsOnly(normalizeIcdTerm(e.nameRu))),
  );
  return staticNames.has(wordsOnly(normalized));
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
  // «М54» with a Cyrillic М, «мигрeнь» with a Latin e: searched as the
  // classifier is (`icdQueryTerms`), and as typed, since the clinic's own
  // wordings were stored the way a doctor once typed them.
  const folded = icdQueryTerms(term);
  const texts = [...new Set([term, folded.text])];
  const codes = [...new Set([term, folded.code])];

  const found = await prisma.clinicDiagnosis.findMany({
    where: {
      OR: [
        ...texts.map((t) => ({ normalized: { contains: t } })),
        ...codes.map((c) => ({
          code: { startsWith: c, mode: "insensitive" as const },
        })),
      ],
    },
    select: { code: true, nameRu: true, usageCount: true },
    orderBy: [{ usageCount: "desc" }, { nameRu: "asc" }],
    take: limit * 2,
  });

  // An entry learned from a draft (never signed, usageCount 0) is offered
  // only while some visit still carries that wording. A typo the doctor
  // corrected a minute later leaves no trace in everyone's picker.
  // As the main diagnosis or as one of the visit's others: those are learned
  // the same way (stored trimmed, as the entry's own wording, so an exact
  // match finds them).
  const unsigned = found.filter((r) => r.usageCount === 0);
  let live = new Set<string>();
  if (unsigned.length > 0) {
    const inUse = await prisma.visitNote.findMany({
      where: {
        OR: unsigned.flatMap((r) => [
          { diagnosisName: { equals: r.nameRu, mode: "insensitive" as const } },
          { additionalDiagnoses: { array_contains: [{ name: r.nameRu }] } },
        ]),
      },
      select: { diagnosisName: true, additionalDiagnoses: true },
      take: 200,
    });
    live = new Set(
      inUse.flatMap((n) => [
        normalizeIcdTerm(n.diagnosisName ?? ""),
        ...parseAdditionalDiagnoses(n.additionalDiagnoses).map((d) =>
          normalizeIcdTerm(d.name),
        ),
      ]),
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

/**
 * The picker's list for a query: the clinic's learned wordings and the
 * classifier's matches, in the order a doctor should meet them (audit CT-05).
 *
 * Learned wordings used to lead unconditionally. One doctor's «мигрень»
 * picked through «Использовать как написано» then sat above G43.0 for every
 * doctor of the clinic, they clicked it, and conclusions went out without a
 * code. Now:
 *   1. learned entries WITH a code (one the classifier lacks, «код знаю, в
 *      базе нет»): the clinic's own coded rubric, first as before;
 *   2. the classifier's matches;
 *   3. learned entries WITHOUT a code, last. They stay in the list (the
 *      caller caps them at a third of it), so a colleague's wording is still
 *      one tap away, but never above a coded rubric of the same query.
 * An uncoded entry whose wording IS a classifier name is dropped: the coded
 * row says the same thing. Duplicates (same code and wording) collapse, so
 * `code|name` is a unique key for the list.
 */
export function mergeDiagnosisHits(
  custom: readonly ClinicCatalogHit[],
  stat: readonly Icd10Entry[],
  limit: number,
): Array<ClinicCatalogHit | Icd10Entry> {
  const coded = custom.filter((c) => c.code.trim());
  const uncoded = custom.filter(
    (c) => !c.code.trim() && !isStaticName(normalizeIcdTerm(c.nameRu)),
  );
  const seen = new Set<string>();
  const out: Array<ClinicCatalogHit | Icd10Entry> = [];
  const push = (row: ClinicCatalogHit | Icd10Entry): boolean => {
    const key = diagnosisHitKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    out.push(row);
    return true;
  };

  for (const c of coded) push(c);
  const room = Math.max(0, limit - out.length - uncoded.length);
  let taken = 0;
  for (const s of stat) {
    if (taken >= room) break;
    if (push(s)) taken += 1;
  }
  for (const c of uncoded) push(c);
  return out.slice(0, limit);
}

/** The identity of a picker row: an uncoded wording has no code to key on. */
export function diagnosisHitKey(row: { code: string; nameRu: string }): string {
  return `${row.code.trim().toUpperCase()}|${normalizeIcdTerm(row.nameRu)}`;
}
