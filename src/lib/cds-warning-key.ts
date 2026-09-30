/**
 * Identity of one CDS warning on the visit screen: what «Я учёл» marks
 * acknowledged and what the override row records as `warningKey`.
 *
 * It was kind + severity + title (audit G4-05). One allergy that reaches
 * two drugs, or three drugs of one class (three pairs), gave warnings with
 * the same title, so they shared a key: React saw duplicate keys and one
 * «Я учёл» struck out all of them while a single CdsOverride was saved. The
 * drugs a warning is about are part of its identity now, and every warning
 * names them in its title too (see drug-check.ts).
 *
 * Client-safe: no server imports.
 */
export type CdsWarningIdentity = {
  kind: string;
  severity: string;
  title: string;
  drugA: { id: string };
  drugB?: { id: string } | null;
};

export function cdsWarningKey(w: CdsWarningIdentity): string {
  const drugs = [w.drugA.id, w.drugB?.id].filter(Boolean).join("+");
  return `${w.kind}:${w.severity}:${w.title}:${drugs}`;
}
