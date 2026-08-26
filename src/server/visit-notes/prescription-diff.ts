/**
 * "Did the prescriptions actually change?" — the trigger for rebuilding the
 * medication bridge (VisitPrescription → Prescription → patient reminders).
 *
 * Why this exists at all: the prescription constructor saves replace-all on
 * every interaction, so the PATCH route cannot use "the client sent a
 * visitPrescriptions array" as the signal. Rebuilding the bridge on every
 * keystroke-adjacent save would re-run the sweep constantly; NOT rebuilding it
 * when a dosage really changed leaves the patient taking a withdrawn regimen.
 * So the decision has to be made on content, and it has to be exact.
 *
 * What counts as a change is deliberately scoped to the fields that reach the
 * patient's reminder: the drug, the amount, the schedule, the duration, the
 * how-to-take text, and the remind-me flag. `drugId`/`form` are catalog
 * bookkeeping — they never alter what the patient is told to do — so they are
 * excluded to avoid pointless rebuilds.
 *
 * Order matters: `sortOrder` is the bridge's idempotency key
 * (@@unique([visitNoteId, visitNoteSortOrder])), so two rows swapping places
 * genuinely re-targets which Prescription row carries which drug.
 */

/** The patient-visible slice of a prescription row, in either direction. */
export type PrescriptionComparable = {
  displayName: string;
  strength?: string | null;
  dose: string;
  timesOfDay: string[];
  mealRelation: string;
  durationDays?: number | null;
  instructionRu?: string | null;
  instructionUz?: string | null;
  remindPatient: boolean;
};

/**
 * Canonical string for one row. Nullish is normalised to "" so that a field
 * moving between `null` and `undefined` (Prisma vs. the Zod-parsed body) is
 * not mistaken for a clinical edit.
 *
 * `timesOfDay` is NOT sorted: the array order is preserved on write, and the
 * bridge maps it through a canonical slot order anyway — comparing raw keeps
 * this helper honest about what is actually stored.
 */
function fingerprint(row: PrescriptionComparable): string {
  return JSON.stringify([
    row.displayName,
    row.strength ?? "",
    row.dose,
    row.timesOfDay,
    row.mealRelation,
    row.durationDays ?? null,
    row.instructionRu ?? "",
    row.instructionUz ?? "",
    row.remindPatient,
  ]);
}

/**
 * True when `next` differs from `before` in any patient-visible way — i.e.
 * when the medication bridge must be rebuilt.
 */
export function didPrescriptionsChange(
  before: PrescriptionComparable[],
  next: PrescriptionComparable[],
): boolean {
  if (before.length !== next.length) return true;
  for (let i = 0; i < before.length; i += 1) {
    if (fingerprint(before[i]!) !== fingerprint(next[i]!)) return true;
  }
  return false;
}
