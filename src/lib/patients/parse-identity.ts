/**
 * Understands how this clinic's doctor actually types a patient.
 *
 * Observed in production after three days of live use: 72 of 94 patients were
 * entered as «Турматов О 1969» — surname, initial, birth year, all in the name
 * field, because that is how he has always written them on paper. The year was
 * therefore invisible to the system: `birthDate` was null for every single
 * patient, so no age on the conclusion, no age filters, no age-aware dosing
 * checks. The remaining 22 were typed by reception as plain «Цой Вадим».
 *
 * Rather than retrain the doctor, parse what he types. A four-digit year
 * anywhere in the string is lifted out into a birth year; whatever remains is
 * the name. Both input styles keep working, and so does a full date if anyone
 * ever types one.
 *
 * Only the YEAR is inferred — we store it as January 1st because that is all
 * the doctor gave us. Callers must present it as «1969 г.р.», never as a
 * precise date, and the age it yields is ±1 year by construction.
 */

/** Nobody alive was born before this; anything earlier is a typo. */
const MIN_YEAR = 1900;

export interface ParsedPatientIdentity {
  /** The name with the year removed and whitespace collapsed. */
  fullName: string;
  /** Four-digit year, or null when the input carried none. */
  birthYear: number | null;
  /** Age in whole years at `today`, or null without a year. */
  age: number | null;
  /** True when a year was found and stripped — drives the UI preview. */
  matched: boolean;
}

/**
 * `today` is injected rather than read from the clock so the result is
 * testable and so a server and a browser in different timezones agree.
 */
export function parsePatientIdentity(
  raw: string,
  today: Date = new Date(),
): ParsedPatientIdentity {
  const input = (raw ?? "").trim();
  if (!input) {
    return { fullName: "", birthYear: null, age: null, matched: false };
  }

  const currentYear = today.getFullYear();

  // Scan every 4-digit run and take the last plausible one. "Last" matters:
  // the year trails the name in this clinic's habit, and a name like
  // «Пациент 2000 2010» should yield the later token as the year only if the
  // earlier one is implausible — in practice both are years and the trailing
  // position wins, matching how it is written.
  let birthYear: number | null = null;
  let matchStart = -1;
  let matchEnd = -1;

  const re = /\d{4}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const value = Number(m[0]);
    if (value >= MIN_YEAR && value <= currentYear) {
      birthYear = value;
      matchStart = m.index;
      matchEnd = m.index + m[0].length;
    }
  }

  if (birthYear === null) {
    return {
      fullName: collapse(input),
      birthYear: null,
      age: null,
      matched: false,
    };
  }

  const withoutYear = input.slice(0, matchStart) + input.slice(matchEnd);
  const fullName = collapse(withoutYear);

  // A bare year with no name at all isn't an identity — hand it back untouched
  // so the caller shows a validation error instead of creating a nameless row.
  if (!fullName) {
    return { fullName: collapse(input), birthYear: null, age: null, matched: false };
  }

  return {
    fullName,
    birthYear,
    age: currentYear - birthYear,
    matched: true,
  };
}

/**
 * Birth date to persist for a parsed year. January 1st — the doctor gave a
 * year, not a date, and inventing a more specific one would be a lie that
 * later looks authoritative.
 */
export function birthDateFromYear(year: number): Date {
  return new Date(Date.UTC(year, 0, 1));
}

/** Collapse runs of whitespace and trim — «Абенов  2016» is common. */
function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * True when the stored birth date is year-only — i.e. it came from
 * `birthDateFromYear` and the day/month are padding, not information.
 *
 * Heuristic by necessity: we store 1 January UTC and keep no "precision" flag,
 * so someone genuinely born on 1 January reads as year-only too. That is the
 * right way to be wrong — saying «1987 г.р.» about a January 1st birthday
 * loses nothing, while printing «01.01.1987» for a patient whose doctor only
 * ever typed «1987» invents a fact on a medical document.
 */
export function isYearOnlyBirthDate(value: Date | string): boolean {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getUTCMonth() === 0 &&
    d.getUTCDate() === 1 &&
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0
  );
}

/** Birth year of a stored date, for «1987 г.р.» style rendering. */
export function birthYearOf(value: Date | string): number {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.getUTCFullYear();
}
