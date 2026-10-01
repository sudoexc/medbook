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

import { isUpcomingVisitStatus } from "@/lib/appointments/active-statuses";

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
 * May the questionnaire still be filled for a visit in this status?
 *
 * Every visit the patient is still expected at: booked, confirmed, or in
 * the waiting room (audit MA-09). Phone and kiosk bookings are created
 * CONFIRMED and reminder answers confirm the rest, so a BOOKED/WAITING-only
 * gate refused the form, with «запись уже завершена», to most patients
 * coming tomorrow. Shared by the 24h push, the POST and the screen.
 */
export function isPreVisitOpenStatus(status: string): boolean {
  return isUpcomingVisitStatus(status);
}

/**
 * Why the form is closed for a visit, so the screen can say it plainly
 * instead of «уже завершена» for a cancelled booking. Null when open.
 */
export type PreVisitClosedReason =
  | "cancelled"
  | "completed"
  | "no_show"
  | "in_progress"
  | "closed";

export function preVisitClosedReason(status: string): PreVisitClosedReason | null {
  if (isPreVisitOpenStatus(status)) return null;
  switch (status) {
    case "CANCELLED":
      return "cancelled";
    case "COMPLETED":
      return "completed";
    case "NO_SHOW":
      return "no_show";
    case "IN_PROGRESS":
      return "in_progress";
    default:
      return "closed";
  }
}

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
  // CONFIRMED too (audit TG-09, MA-09): every phone booking is confirmed at
  // creation, so leaving it out skipped the bulk of the clinic's visits.
  // The same shared gate covers the Mini App submit, so whatever is sent
  // can be answered.
  if (!isPreVisitOpenStatus(row.status)) return false;
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
