/**
 * The diagnoses of one visit: a main one and up to three more.
 *
 * Clinic request (29.09.2026): one patient often leaves with one to four
 * diagnoses (migraine with a tension headache and cervicalgia, say), and the
 * conclusion held only one. The main diagnosis stays where it always was,
 * `VisitNote.diagnosisCode` / `diagnosisName`, so every reader that knows
 * only those keeps working and an older note reads exactly as before. The
 * others live in `VisitNote.additionalDiagnoses`, a JSON array in the
 * doctor's order.
 *
 * Pure and client-safe: the PATCH and finalize routes, the print and
 * handout templates, the CDS check and the reception screen all read the
 * set through these helpers, so they agree on what counts as the same
 * diagnosis and in which order the diagnoses come.
 */

/** «1 + 3»: the main diagnosis and at most this many more. */
export const MAX_ADDITIONAL_DIAGNOSES = 3;

/**
 * One further diagnosis. `code` is the ICD-10 code, or null for a diagnosis
 * written in the clinic's own words (then the name is all there is).
 */
export type VisitDiagnosis = { code: string | null; name: string };

/** A diagnosis of the visit in reading order, the main one first. */
export type ListedDiagnosis = {
  code: string | null;
  name: string | null;
  main: boolean;
};

/** The whole set as a note stores it. */
export type NoteDiagnoses = {
  diagnosisCode: string | null;
  diagnosisName: string | null;
  additionalDiagnoses: VisitDiagnosis[];
};

type NoteDiagnosesLike = {
  diagnosisCode?: string | null;
  diagnosisName?: string | null;
  /** The JSON column as Prisma hands it back, or an already parsed list. */
  additionalDiagnoses?: unknown;
};

/**
 * The stored list, read defensively: the column is JSON, so a malformed
 * entry is skipped instead of breaking a print or a signature. A note
 * written before the column existed (or a mocked one) has none.
 */
export function parseAdditionalDiagnoses(value: unknown): VisitDiagnosis[] {
  if (!Array.isArray(value)) return [];
  const out: VisitDiagnosis[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as { code?: unknown; name?: unknown };
    const code = typeof raw.code === "string" ? raw.code.trim() : "";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!code && !name) continue;
    // A code without words still names a diagnosis; show the code then.
    out.push({ code: code || null, name: name || code });
  }
  return out;
}

/**
 * What makes two diagnoses the same: the ICD code when there is one (case
 * aside), else the words (case and spacing aside). Null for an empty one.
 */
export function visitDiagnosisKey(d: {
  code?: string | null;
  name?: string | null;
}): string | null {
  const code = d.code?.trim().toUpperCase();
  if (code) return `code:${code}`;
  const name = d.name?.trim().toLowerCase().replace(/\s+/g, " ");
  return name ? `text:${name}` : null;
}

/**
 * The set as it is to be stored, whatever the editor sent:
 *   - codes and names trimmed, a blank one dropped;
 *   - a diagnosis that is the main one, or is listed earlier, dropped
 *     (picking the main diagnosis among the others swaps it out of them);
 *   - no main diagnosis but others: the first of them becomes the main one,
 *     so the set is always «main, then the rest» and a reader of the main
 *     columns never misses a diagnosis the note has;
 *   - at most MAX_ADDITIONAL_DIAGNOSES others.
 */
export function normalizeNoteDiagnoses(input: NoteDiagnosesLike): NoteDiagnoses {
  let code = input.diagnosisCode?.trim() || null;
  let name = input.diagnosisName?.trim() || null;
  let rest = parseAdditionalDiagnoses(input.additionalDiagnoses);
  if (!code && !name && rest.length > 0) {
    const [first, ...others] = rest;
    code = first!.code;
    name = first!.name;
    rest = others;
  }
  const seen = new Set<string>();
  const mainKey = visitDiagnosisKey({ code, name });
  if (mainKey) seen.add(mainKey);
  const additional: VisitDiagnosis[] = [];
  for (const d of rest) {
    const key = visitDiagnosisKey(d);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    additional.push(d);
    if (additional.length === MAX_ADDITIONAL_DIAGNOSES) break;
  }
  return { diagnosisCode: code, diagnosisName: name, additionalDiagnoses: additional };
}

/** Every diagnosis of the note in reading order, the main one first. */
export function visitDiagnosesOf(note: NoteDiagnosesLike): ListedDiagnosis[] {
  const out: ListedDiagnosis[] = [];
  const code = note.diagnosisCode?.trim() || null;
  const name = note.diagnosisName?.trim() || null;
  if (code || name) out.push({ code, name, main: true });
  for (const d of parseAdditionalDiagnoses(note.additionalDiagnoses)) {
    out.push({ code: d.code, name: d.name, main: false });
  }
  return out;
}

/** The ICD codes of the note, main first, each once. */
export function visitDiagnosisCodes(note: NoteDiagnosesLike): string[] {
  const out: string[] = [];
  for (const d of visitDiagnosesOf(note)) {
    if (d.code && !out.includes(d.code)) out.push(d.code);
  }
  return out;
}

/** Did the set change? Order counts: the main one and the order are the doctor's. */
export function sameNoteDiagnoses(a: NoteDiagnosesLike, b: NoteDiagnosesLike): boolean {
  const flat = (n: NoteDiagnosesLike) =>
    JSON.stringify([
      n.diagnosisCode ?? null,
      n.diagnosisName ?? null,
      parseAdditionalDiagnoses(n.additionalDiagnoses).map((d) => [d.code, d.name]),
    ]);
  return flat(a) === flat(b);
}

/**
 * One diagnosis on one line: «G43.0 · Мигрень без ауры», or whichever half
 * exists. Empty for an empty one.
 */
export function formatVisitDiagnosis(
  d: { code?: string | null; name?: string | null },
  separator = " · ",
): string {
  const code = d.code?.trim() || null;
  const name = d.name?.trim() || null;
  // A code stored without words reads it as its name: print it once.
  return [code, name === code ? null : name]
    .filter((v): v is string => Boolean(v))
    .join(separator);
}

/**
 * The diagnoses after the main one on one line, in the doctor's order:
 * «M54.2 · Цервикалгия; G44.2 · Головная боль напряжённого типа». Empty
 * when there are none. The history lists show it under the main diagnosis.
 */
export function formatAdditionalDiagnoses(value: unknown): string {
  return parseAdditionalDiagnoses(value)
    .map((d) => formatVisitDiagnosis(d))
    .filter(Boolean)
    .join("; ");
}
