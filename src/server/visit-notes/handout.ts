/**
 * The patient's handout, composed from the note's structured fields.
 *
 * Since the handout tab was removed (clinic decision 21.09.2026) nobody
 * writes the handout by hand: it is the diagnosis, the prescriptions, the
 * advice and the follow-up of the note, rendered for the patient. Audit
 * VW-02 found it was composed ONCE, at the first signature, and then frozen:
 * a dose corrected inside the 24h window, or a drug removed after a revert
 * and re-sign, left the old text in the PDF («Конкор 5 мг» above a schedule
 * grid saying 10 мг) and in the Mini App visit summary. So the handout is
 * now recomposed whenever what it is made of changes: at every signature
 * and on every in-window correction of a signed note.
 *
 * One composer for both paths, so the text cannot drift between them.
 */
import { composePatientHandout } from "@/lib/catalogs/handout-composer";
import {
  formatPrescriptionLines,
  type PrescriptionLikeRow,
} from "@/lib/catalogs/prescription-format";

/**
 * Note fields the handout is composed from. An accepted change to any of
 * them makes the stored handout wrong (`visitPrescriptions` counts only
 * when the list really changed, see the PATCH route).
 */
export const HANDOUT_SOURCE_FIELDS = [
  "diagnosisName",
  "complaints",
  "prescriptions",
  "advice",
  "followUpNote",
  "visitPrescriptions",
] as const;

export function touchesHandout(changedFields: Iterable<string>): boolean {
  const sources = new Set<string>(HANDOUT_SOURCE_FIELDS);
  for (const f of changedFields) if (sources.has(f)) return true;
  return false;
}

/** Who and when: the letterhead of the handout. */
export type HandoutContext = {
  patient?: { fullName: string | null } | null;
  doctor?: { nameRu: string | null; specializationRu: string | null } | null;
  clinic?: { nameRu: string | null } | null;
  appointment?: { date: Date } | null;
};

/** What the handout says. */
export type HandoutFields = {
  diagnosisName: string | null;
  complaints: string[] | null;
  prescriptions: string[] | null;
  advice: string[] | null;
  followUpNote: string | null;
  visitPrescriptions: PrescriptionLikeRow[] | null;
};

/**
 * The handout for this note, or null when there is genuinely nothing to tell
 * the patient (then no blank sheet is issued).
 */
export function composeNoteHandout(
  context: HandoutContext,
  fields: HandoutFields,
  now: Date = new Date(),
): string | null {
  return (
    composePatientHandout({
      locale: "ru",
      patientName: context.patient?.fullName ?? null,
      doctorName: context.doctor?.nameRu ?? null,
      doctorSpecialty: context.doctor?.specializationRu ?? null,
      clinicName: context.clinic?.nameRu ?? null,
      visitDate: context.appointment?.date ?? now,
      diagnosisName: fields.diagnosisName,
      complaints: fields.complaints ?? [],
      prescriptions: [
        ...formatPrescriptionLines(fields.visitPrescriptions ?? [], "ru", {
          withInstruction: true,
        }),
        ...(fields.prescriptions ?? []),
      ],
      advice: fields.advice ?? [],
      followUp: fields.followUpNote,
    }) || null
  );
}
