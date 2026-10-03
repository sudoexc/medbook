/**
 * «Новый пациент» on the reception tablet: ФИО, телефон, год рождения and,
 * if the receptionist taps it, the sex.
 *
 * The year travels inside the name («Каримов Тимур 2012»): both create paths
 * the tablet uses (the walk-in route and POST /api/crm/patients) lift a
 * trailing year out into `birthDate` with `parsePatientIdentity`, and the
 * phone-owner check compares it with the card that already holds the
 * number. One field less on the wire, the same card in the end.
 *
 * Pure: shared by the page and the unit tests.
 */
import { isCompleteLocal, toE164 } from "./phone";

/** Same floor as `parsePatientIdentity`: nobody alive was born earlier. */
export const MIN_BIRTH_YEAR = 1900;

export type NewPatientDraft = {
  fullName: string;
  /** National digits, see `lib/reception-tablet/phone`. */
  phoneLocal: string;
  /** As typed: «», «19», «1985». */
  birthYear: string;
  gender: "MALE" | "FEMALE" | null;
};

export const EMPTY_NEW_PATIENT: NewPatientDraft = {
  fullName: "",
  phoneLocal: "",
  birthYear: "",
  gender: null,
};

export type NewPatientErrors = {
  fullName?: "required" | "short";
  phone?: "required" | "incomplete";
  birthYear?: "invalid";
};

export type ValidNewPatient = {
  /** The name as the API gets it, with the year appended when given. */
  fullName: string;
  phone: string;
  birthYear: number | null;
  gender: "MALE" | "FEMALE" | null;
};

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * The birth year typed so far as a number, `null` for an empty field, or
 * `"invalid"` for anything that is not a plausible four digit year.
 */
export function parseBirthYear(
  raw: string,
  now: Date = new Date(),
): number | null | "invalid" {
  const v = raw.trim();
  if (!v) return null;
  if (!/^\d{4}$/.test(v)) return "invalid";
  const year = Number(v);
  if (year < MIN_BIRTH_YEAR || year > now.getFullYear()) return "invalid";
  return year;
}

/** Keeps the year field to four digits as it is typed. */
export function birthYearInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 4);
}

/** A year written into the name by habit: «Турматов О 1969». */
const YEAR_TOKEN = /(?:^|\s)(?:19|20)\d{2}(?=\s|$)/g;

/**
 * The name for the API, collapsed. With a year in its own field, that year
 * is appended and one typed into the name by habit is dropped, so the card
 * never gets two; without one, the name goes as typed and the server lifts
 * a year out of it as it always has.
 */
export function newPatientFullName(fullName: string, birthYear: number | null): string {
  const name = collapse(fullName);
  if (birthYear === null) return name;
  return `${collapse(name.replace(YEAR_TOKEN, " "))} ${birthYear}`;
}

/** The name as people read it: «Каримов Тимур 2012» shows as «Каримов Тимур». */
export function nameWithoutYear(fullName: string): string {
  return collapse(fullName.replace(/\s(?:19|20)\d{2}$/, ""));
}

/** At least two letters: «Ли» is a surname, «1» and «.» are not names. */
function hasEnoughLetters(name: string): boolean {
  return (name.match(/\p{L}/gu) ?? []).length >= 2;
}

export function validateNewPatient(
  draft: NewPatientDraft,
  now: Date = new Date(),
):
  | { ok: true; value: ValidNewPatient }
  | { ok: false; errors: NewPatientErrors } {
  const errors: NewPatientErrors = {};
  const name = collapse(draft.fullName);
  if (!name) errors.fullName = "required";
  else if (!hasEnoughLetters(name)) errors.fullName = "short";

  if (!draft.phoneLocal) errors.phone = "required";
  else if (!isCompleteLocal(draft.phoneLocal)) errors.phone = "incomplete";

  const year = parseBirthYear(draft.birthYear, now);
  if (year === "invalid") errors.birthYear = "invalid";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  // A year typed into the name by habit («Турматов О 1969») counts when the
  // year field was left empty: the server would lift it out anyway.
  const typedInName = name.match(/\s((?:19|20)\d{2})$/);
  const fromName = typedInName ? parseBirthYear(typedInName[1]!, now) : null;
  const birthYear =
    year !== null && year !== "invalid" ? year : typeof fromName === "number" ? fromName : null;
  return {
    ok: true,
    value: {
      fullName: newPatientFullName(name, birthYear),
      phone: toE164(draft.phoneLocal)!,
      birthYear,
      gender: draft.gender,
    },
  };
}

/**
 * The search text carried into a fresh «Новый пациент» form, so nothing is
 * typed twice: digits become the phone, words the name.
 */
export function draftFromSearch(input: {
  phoneLocal?: string;
  nameQuery?: string;
}): NewPatientDraft {
  const name = collapse(input.nameQuery ?? "");
  const yearMatch = name.match(/(?:^|\s)((?:19|20)\d{2})$/);
  return {
    ...EMPTY_NEW_PATIENT,
    phoneLocal: input.phoneLocal ?? "",
    fullName: yearMatch ? collapse(name.slice(0, yearMatch.index)) : name,
    birthYear: yearMatch ? yearMatch[1]! : "",
  };
}
