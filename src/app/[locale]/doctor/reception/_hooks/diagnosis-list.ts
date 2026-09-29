/**
 * Pure edits of the visit's diagnosis list: the main one and up to three
 * more (clinic request 29.09.2026, «бир одамда 1-4 хил диагноз»).
 *
 * Like the prescription rows (prescription-rows.ts), the set is saved
 * replace-all: every action sends the main diagnosis AND the whole list of
 * the others. So an action is composed on the note as the doctor last left
 * it (the query cache, which the patch queue updates the moment an edit is
 * made), never on the render snapshot: «убрал основной, сразу убрал ещё
 * один» fires two actions before the first answer, and the second, built on
 * the snapshot, would bring the first one back (audit VW-01).
 *
 * Every edit returns the whole set settled exactly as the server settles it
 * (normalizeNoteDiagnoses), so what the doctor sees before the answer is
 * what the answer says; or null when the edit changes nothing.
 */
import {
  MAX_ADDITIONAL_DIAGNOSES,
  normalizeNoteDiagnoses,
  sameNoteDiagnoses,
  visitDiagnosesOf,
  visitDiagnosisKey,
  type NoteDiagnoses,
} from "@/lib/visit-diagnoses";

/** «1 + 3»: the most diagnoses one visit holds. */
export const MAX_VISIT_DIAGNOSES = MAX_ADDITIONAL_DIAGNOSES + 1;

/**
 * One diagnosis as the card lists it. The name stays null for a main
 * diagnosis stored as a bare code: rewriting it to the code on an unrelated
 * edit would change a stored field the doctor never touched.
 */
export type DiagnosisItem = { code: string | null; name: string | null };

type NoteLike = {
  diagnosisCode?: string | null;
  diagnosisName?: string | null;
  additionalDiagnoses?: unknown;
};

/** The visit's diagnoses in order, the main one first. */
export function diagnosisListOf(note: NoteLike): DiagnosisItem[] {
  return visitDiagnosesOf(note).map((d) => ({ code: d.code, name: d.name }));
}

/** The list back into the note's fields: the first is the main one. */
function setOf(list: DiagnosisItem[]): NoteDiagnoses {
  const [main, ...rest] = list;
  return normalizeNoteDiagnoses({
    diagnosisCode: main?.code ?? null,
    diagnosisName: main?.name ?? null,
    additionalDiagnoses: rest.map((d) => ({
      code: d.code,
      name: d.name ?? d.code ?? "",
    })),
  });
}

function changed(note: NoteLike, next: NoteDiagnoses): NoteDiagnoses | null {
  return sameNoteDiagnoses(note, next) ? null : next;
}

/** Is this diagnosis (same code, or same words) already on the visit? */
export function hasDiagnosis(
  note: NoteLike,
  d: { code?: string | null; name?: string | null },
): boolean {
  const key = visitDiagnosisKey(d);
  if (!key) return false;
  return diagnosisListOf(note).some((x) => visitDiagnosisKey(x) === key);
}

/** Room for one more? */
export function canAddDiagnosis(note: NoteLike): boolean {
  return diagnosisListOf(note).length < MAX_VISIT_DIAGNOSES;
}

/**
 * A picked diagnosis (search, shortlist, ICD catalog, «Было раньше»): the
 * main one while the visit has none, otherwise one more after the others.
 * Null when it is already on the visit, empty, or the visit is full.
 */
export function withDiagnosisPicked(
  note: NoteLike,
  d: DiagnosisItem,
): NoteDiagnoses | null {
  const code = d.code?.trim() || null;
  const name = d.name?.trim() || null;
  if (!code && !name) return null;
  if (hasDiagnosis(note, { code, name })) return null;
  const list = diagnosisListOf(note);
  if (list.length >= MAX_VISIT_DIAGNOSES) return null;
  return changed(note, setOf([...list, { code, name }]));
}

/**
 * Where a diagnosis sits in the live list. Found by what it is, not by the
 * position it had on screen: a pending edit may have reordered the list
 * since that render, and an index would then point at another diagnosis.
 */
function indexIn(list: DiagnosisItem[], target: DiagnosisItem): number {
  const key = visitDiagnosisKey(target);
  return key ? list.findIndex((d) => visitDiagnosisKey(d) === key) : -1;
}

/**
 * Remove one. Removing the main one promotes the next, the same rule the
 * server applies, so the visit never holds others without a main one.
 */
export function withDiagnosisRemoved(
  note: NoteLike,
  target: DiagnosisItem,
): NoteDiagnoses | null {
  const list = diagnosisListOf(note);
  const index = indexIn(list, target);
  if (index < 0) return null;
  return changed(note, setOf(list.filter((_, i) => i !== index)));
}

/**
 * «Сделать основным»: this one moves to the front and the former main one
 * becomes the first of the others, so the rest keep the doctor's order.
 */
export function withDiagnosisMadeMain(
  note: NoteLike,
  target: DiagnosisItem,
): NoteDiagnoses | null {
  const list = diagnosisListOf(note);
  const index = indexIn(list, target);
  if (index <= 0) return null;
  return changed(
    note,
    setOf([list[index]!, ...list.filter((_, i) => i !== index)]),
  );
}
