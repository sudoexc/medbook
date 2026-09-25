/**
 * The «Редактировать» form of the patient card, as data (audit PT-01).
 *
 * Kept apart from the dialog so the rule «send only what staff changed» is
 * testable: an untouched field must not reach the PATCH. Re-sending the
 * phone would be harmless, but re-sending a year-only birth date or the
 * name would re-run the year parsing, and the audit diff would list fields
 * nobody touched.
 */
import type { Patient, PatientUpdateInput } from "../_hooks/use-patient";

export type EditPatientDraft = {
  fullName: string;
  phone: string;
  /** `YYYY-MM-DD`, or "" for no date. */
  birthDate: string;
  gender: "MALE" | "FEMALE" | "";
  address: string;
  passport: string;
  source: NonNullable<Patient["source"]> | "";
  preferredLang: Patient["preferredLang"];
};

type EditablePatient = Pick<
  Patient,
  | "fullName"
  | "phone"
  | "birthDate"
  | "gender"
  | "address"
  | "passport"
  | "source"
  | "preferredLang"
>;

export type EditPatientError = "name" | "phone";

/** Birth dates are stored at UTC midnight, so the UTC day is the date. */
function isoDay(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function draftFromPatient(p: EditablePatient): EditPatientDraft {
  return {
    fullName: p.fullName,
    phone: p.phone ?? "",
    birthDate: isoDay(p.birthDate),
    gender: p.gender ?? "",
    address: p.address ?? "",
    passport: p.passport ?? "",
    source: p.source ?? "",
    preferredLang: p.preferredLang,
  };
}

/**
 * The PATCH body for the fields staff changed, or the first field that
 * cannot be saved. An empty patch means nothing changed.
 */
export function editPatientPatch(
  p: EditablePatient,
  d: EditPatientDraft,
):
  | { ok: true; patch: PatientUpdateInput }
  | { ok: false; error: EditPatientError } {
  const before = draftFromPatient(p);
  const patch: PatientUpdateInput = {};

  const fullName = collapse(d.fullName);
  if (fullName !== collapse(before.fullName)) {
    if (fullName.length < 2) return { ok: false, error: "name" };
    patch.fullName = fullName;
  }

  const phone = d.phone.trim();
  if (phone !== before.phone.trim()) {
    // A number can be corrected, never removed: the card is found by it.
    if (phone.replace(/\D/g, "").length < 7) return { ok: false, error: "phone" };
    patch.phone = phone;
  }

  if (d.birthDate !== before.birthDate) {
    patch.birthDate = d.birthDate || null;
  }
  if (d.gender !== before.gender) patch.gender = d.gender || null;
  if (d.source !== before.source) patch.source = d.source || null;
  if (d.preferredLang !== before.preferredLang) {
    patch.preferredLang = d.preferredLang;
  }

  const address = d.address.trim();
  if (address !== before.address.trim()) patch.address = address || null;
  const passport = d.passport.trim();
  if (passport !== before.passport.trim()) patch.passport = passport || null;

  return { ok: true, patch };
}
