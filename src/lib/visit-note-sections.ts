/**
 * What a conclusion is missing, and whether a draft says anything at all.
 *
 * One definition for every place that signs a conclusion: the reception's
 * sign bar, the conclusion card's «Подписать» and the server's refusal to
 * close a visit around an unsigned draft (audit DC-01). They used to be
 * separate inline checks, and a doctor could close a visit on My Day with the
 * conclusion still a draft.
 */

import { parseAdditionalDiagnoses } from "@/lib/visit-diagnoses";

export type ConclusionSection = "diagnosis" | "conclusion" | "prescriptions";

export type NoteSectionsInput = {
  diagnosisCode?: string | null;
  diagnosisName?: string | null;
  /**
   * The visit's other diagnoses (JSON as stored, or parsed). Optional ones:
   * they never stand in for the main diagnosis, but a draft holding only
   * them is not blank.
   */
  additionalDiagnoses?: unknown;
  bodyMarkdown?: string | null;
  prescriptions?: readonly string[] | null;
  complaints?: readonly string[] | null;
  anamnesis?: readonly string[] | null;
  examination?: readonly string[] | null;
  advice?: readonly string[] | null;
  /** Number of structured prescription rows. */
  structuredRx: number;
};

export type EmptySectionsOptions = {
  /**
   * Whether an empty conclusion text is worth asking about. True where the
   * doctor has a text editor to fill (the conclusion card). The visit
   * screen lost its editor (clinic request 03.10.2026: nobody wrote in it),
   * so a visit signed from there, or closed from My Day, never asks «sign
   * without a conclusion?» about a field the doctor has nowhere to fill.
   */
  requireConclusion?: boolean;
};

/**
 * Sections worth a confirmation before signing: a conclusion may be signed
 * without them (clinic decision 23.09.2026), but never by accident. The
 * diagnosis section means the MAIN diagnosis: the others are optional, and
 * the server never keeps others without a main one (visit-diagnoses.ts).
 */
export function emptyConclusionSections(
  n: NoteSectionsInput,
  { requireConclusion = true }: EmptySectionsOptions = {},
): ConclusionSection[] {
  const out: ConclusionSection[] = [];
  if (!n.diagnosisCode?.trim() && !n.diagnosisName?.trim()) out.push("diagnosis");
  if (requireConclusion && !n.bodyMarkdown?.trim()) out.push("conclusion");
  if (n.structuredRx === 0 && (n.prescriptions?.length ?? 0) === 0) {
    out.push("prescriptions");
  }
  return out;
}

/**
 * Did the doctor write anything into this draft? A reception opened and left
 * blank has nothing to sign, and closing its visit loses nothing. Text in
 * the conclusion counts whatever the screen it came from (an older note, a
 * protocol template, the AI rail).
 */
export function draftHasContent(n: NoteSectionsInput): boolean {
  const any = (xs?: readonly string[] | null) =>
    (xs ?? []).some((x) => x.trim().length > 0);
  return (
    emptyConclusionSections(n).length < 3 ||
    parseAdditionalDiagnoses(n.additionalDiagnoses).length > 0 ||
    any(n.complaints) ||
    any(n.anamnesis) ||
    any(n.examination) ||
    any(n.advice)
  );
}
