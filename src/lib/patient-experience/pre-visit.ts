/**
 * Phase 16 Wave 2 — Pre-visit questionnaire shape + validators.
 *
 * The patient fills a 4-field form 24h before their appointment via the Mini
 * App. The submitted blob is stored on `Appointment.preVisitData` (JSON) and
 * read by both the Mini App (prefill on edit) and the CRM appointment drawer
 * (`<PreVisitQuestionnaireCard>`).
 *
 * Validation is deliberately simple — no medical-grade structured ontologies
 * (RxNorm / ICD-10) yet. Free-text complaints + comma-split lists for
 * allergies / medications keep the bar low for the patient.
 */
import { z } from "zod";

export type PreVisitData = {
  complaints: string;
  allergies: string[];
  medications: string[];
  notes: string;
  locale: "ru" | "uz";
};

/**
 * Form-submission Zod schema. Server endpoint accepts {complaints, allergies,
 * medications, notes} only; `locale` is filled in by the API handler from the
 * patient's `preferredLang`.
 */
export const PreVisitSubmissionSchema = z.object({
  complaints: z
    .string()
    .trim()
    .min(1, "complaints_required")
    .max(2000, "complaints_too_long"),
  allergies: z
    .array(z.string().trim().min(1).max(120))
    .max(20, "allergies_too_many"),
  medications: z
    .array(z.string().trim().min(1).max(200))
    .max(20, "medications_too_many"),
  notes: z.string().trim().max(1000, "notes_too_long").default(""),
});

export type PreVisitSubmissionInput = z.infer<typeof PreVisitSubmissionSchema>;

/**
 * Eligibility check: whether the worker should enqueue a 24h-before push
 * for this row. Pure helper — no DB access. Used from the worker tick AND
 * the unit tests.
 */
export function isPreVisitEligible(row: {
  startsAt: Date;
  status: string;
  preVisitNotifiedAt: Date | null;
  preVisitSubmittedAt: Date | null;
  patientHasContact: boolean;
}, now: Date = new Date()): boolean {
  if (row.preVisitNotifiedAt !== null) return false;
  if (row.preVisitSubmittedAt !== null) return false;
  if (!row.patientHasContact) return false;
  if (row.status !== "BOOKED" && row.status !== "WAITING") return false;
  // 23–25h window from now.
  const ms = row.startsAt.getTime() - now.getTime();
  const lower = 23 * 60 * 60 * 1000;
  const upper = 25 * 60 * 60 * 1000;
  return ms >= lower && ms <= upper;
}

/**
 * Coerce a stored JSON value back into a `PreVisitData` shape. Returns `null`
 * if the value is missing / malformed so the UI can fall back to "not filled".
 */
export function parsePreVisitData(value: unknown): PreVisitData | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const complaints = typeof v.complaints === "string" ? v.complaints : "";
  const allergies = Array.isArray(v.allergies)
    ? (v.allergies as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
  const medications = Array.isArray(v.medications)
    ? (v.medications as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
  const notes = typeof v.notes === "string" ? v.notes : "";
  const locale = v.locale === "uz" ? "uz" : "ru";
  if (!complaints && allergies.length === 0 && medications.length === 0 && !notes) {
    return null;
  }
  return { complaints, allergies, medications, notes, locale };
}
