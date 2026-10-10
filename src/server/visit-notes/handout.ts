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
 *
 * In the patient's language (audit VW-07). It was always Russian: a patient
 * who reads Uzbek got a PDF titled «Bemor uchun eslatma», an Uzbek intake
 * grid and a Russian text in between. The PDF worker and the print already
 * followed `Patient.preferredLang`; now the text they carry does too.
 */
import {
  composePatientHandout,
  type HandoutLocale,
} from "@/lib/catalogs/handout-composer";
import { parseAdditionalDiagnoses } from "@/lib/visit-diagnoses";
import {
  formatPatientLines,
  type PrescriptionLikeRow,
} from "@/lib/catalogs/prescription-format";

/**
 * Note fields the handout is composed from. An accepted change to any of
 * them makes the stored handout wrong (`visitPrescriptions` counts only
 * when the list really changed, see the PATCH route).
 */
export const HANDOUT_SOURCE_FIELDS = [
  "diagnosisName",
  "additionalDiagnoses",
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
  patient?: {
    fullName: string | null;
    /** RU | UZ; the handout is written in it. */
    preferredLang?: string | null;
  } | null;
  doctor?: {
    nameRu: string | null;
    specializationRu: string | null;
    nameUz?: string | null;
    specializationUz?: string | null;
  } | null;
  clinic?: { nameRu: string | null; nameUz?: string | null } | null;
  appointment?: { date: Date } | null;
};

/** The language the patient reads, as the PDF worker picks it. */
export function handoutLocaleOf(context: HandoutContext): HandoutLocale {
  return context.patient?.preferredLang === "UZ" ? "uz" : "ru";
}

/** What the handout says. */
export type HandoutFields = {
  diagnosisName: string | null;
  /**
   * The visit's other diagnoses, as the note stores them (the JSON column)
   * or already parsed. Optional: a note without them composes as before.
   */
  additionalDiagnoses?: unknown;
  complaints: string[] | null;
  prescriptions: string[] | null;
  advice: string[] | null;
  followUpNote: string | null;
  visitPrescriptions: PrescriptionLikeRow[] | null;
};

/**
 * The handout for this note, or null when there is genuinely nothing to tell
 * the patient (then no blank sheet is issued). In the patient's language
 * unless the caller names one (the print's RU/UZ switch).
 */
export function composeNoteHandout(
  context: HandoutContext,
  fields: HandoutFields,
  now: Date = new Date(),
  locale: HandoutLocale = handoutLocaleOf(context),
): string | null {
  const uz = locale === "uz";
  // The Uzbek names where the clinic filled them in, else the Russian ones.
  const pick = (u: string | null | undefined, r: string | null | undefined) =>
    (uz ? u?.trim() : null) || r || null;
  return (
    composePatientHandout({
      locale,
      patientName: context.patient?.fullName ?? null,
      doctorName: pick(context.doctor?.nameUz, context.doctor?.nameRu),
      doctorSpecialty: pick(
        context.doctor?.specializationUz,
        context.doctor?.specializationRu,
      ),
      clinicName: pick(context.clinic?.nameUz, context.clinic?.nameRu),
      visitDate: context.appointment?.date ?? now,
      diagnosisName: fields.diagnosisName,
      // Names only: the patient's copy never carries ICD codes.
      additionalDiagnosisNames: parseAdditionalDiagnoses(
        fields.additionalDiagnoses,
      ).map((d) => d.name),
      complaints: fields.complaints ?? [],
      prescriptions: [
        ...formatPatientLines(fields.visitPrescriptions ?? [], locale, {
          withInstruction: true,
        }),
        ...(fields.prescriptions ?? []),
      ],
      advice: fields.advice ?? [],
      followUp: fields.followUpNote,
    }) || null
  );
}
