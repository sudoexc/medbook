/**
 * What a conclusion is missing, and whether a draft says anything at all.
 *
 * One definition for every place that signs a conclusion: the reception's
 * sign bar, the conclusion card's «Подписать» and the server's refusal to
 * close a visit around an unsigned draft (audit DC-01). They used to be
 * separate inline checks, and a doctor could close a visit on My Day with the
 * conclusion still a draft.
 */

export type ConclusionSection = "diagnosis" | "conclusion" | "prescriptions";

export type NoteSectionsInput = {
  diagnosisCode?: string | null;
  diagnosisName?: string | null;
  bodyMarkdown?: string | null;
  prescriptions?: readonly string[] | null;
  complaints?: readonly string[] | null;
  anamnesis?: readonly string[] | null;
  examination?: readonly string[] | null;
  advice?: readonly string[] | null;
  /** Number of structured prescription rows. */
  structuredRx: number;
};

/**
 * Sections worth a confirmation before signing: a conclusion may be signed
 * without them (clinic decision 23.09.2026), but never by accident.
 */
export function emptyConclusionSections(
  n: NoteSectionsInput,
): ConclusionSection[] {
  const out: ConclusionSection[] = [];
  if (!n.diagnosisCode?.trim() && !n.diagnosisName?.trim()) out.push("diagnosis");
  if (!n.bodyMarkdown?.trim()) out.push("conclusion");
  if (n.structuredRx === 0 && (n.prescriptions?.length ?? 0) === 0) {
    out.push("prescriptions");
  }
  return out;
}

/**
 * Did the doctor write anything into this draft? A reception opened and left
 * blank has nothing to sign, and closing its visit loses nothing.
 */
export function draftHasContent(n: NoteSectionsInput): boolean {
  const any = (xs?: readonly string[] | null) =>
    (xs ?? []).some((x) => x.trim().length > 0);
  return (
    emptyConclusionSections(n).length < 3 ||
    any(n.complaints) ||
    any(n.anamnesis) ||
    any(n.examination) ||
    any(n.advice)
  );
}
